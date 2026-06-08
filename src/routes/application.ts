import { Router, Request, Response } from 'express';
import { store } from '../store';
import { success, fail, paginate, generateToken, addDays } from '../utils';
import {
  Application,
  ApplicationRequest,
  ApprovalRequest,
  Contract,
  AuthorizationToken,
  ApplicationStatus,
} from '../types';

const router = Router();

router.post('/apply', (req: Request, res: Response) => {
  const body = req.body as ApplicationRequest;

  if (!body.productId || !body.applicantId || !body.applicantName) {
    return fail(res, '产品ID、申请人ID和申请人名称为必填项');
  }
  if (!body.type || !body.purpose) {
    return fail(res, '申请类型和用途说明为必填项');
  }

  const product = store.products.get(body.productId);
  if (!product) {
    return fail(res, '产品不存在');
  }
  if (product.status !== 'active') {
    return fail(res, '产品当前不可用');
  }

  const now = store.now();
  const application: Application = {
    id: store.generateId(),
    productId: body.productId,
    productName: product.name,
    applicantId: body.applicantId,
    applicantName: body.applicantName,
    type: body.type,
    purpose: body.purpose,
    status: 'pending',
    submittedAt: now,
  };

  store.applications.set(application.id, application);

  store.addCirculationRecord(
    'application',
    product.id,
    product.name,
    application.applicantId,
    application.applicantName,
    'consumer',
    `${application.applicantName} 提交了产品「${product.name}」的${body.type === 'trial' ? '试用' : '正式'}申请`,
    { applicationId: application.id, type: body.type }
  );

  return success(res, application, '申请提交成功');
});

router.get('/list', (req: Request, res: Response) => {
  const { applicantId, productId, status, page, pageSize } = req.query;
  let applications = Array.from(store.applications.values());

  if (applicantId) {
    applications = applications.filter((a) => a.applicantId === applicantId);
  }
  if (productId) {
    applications = applications.filter((a) => a.productId === productId);
  }
  if (status) {
    const validStatuses: ApplicationStatus[] = ['pending', 'approved', 'rejected', 'cancelled'];
    if (validStatuses.includes(status as ApplicationStatus)) {
      applications = applications.filter((a) => a.status === status);
    }
  }

  applications.sort(
    (a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()
  );

  const result = paginate(applications, Number(page), Number(pageSize));
  return success(res, result);
});

router.get('/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const application = store.applications.get(id);
  if (!application) {
    return fail(res, '申请不存在', 404);
  }
  return success(res, application);
});

router.post('/approve', (req: Request, res: Response) => {
  const body = req.body as ApprovalRequest;

  if (!body.applicationId || !body.reviewerId || !body.reviewerName) {
    return fail(res, '申请ID、审批人ID和审批人名称为必填项');
  }
  if (body.approved === undefined) {
    return fail(res, '审批结果为必填项');
  }

  const application = store.applications.get(body.applicationId);
  if (!application) {
    return fail(res, '申请不存在');
  }
  if (application.status !== 'pending') {
    return fail(res, '该申请已处理，无法重复审批');
  }

  const product = store.products.get(application.productId);
  if (!product) {
    return fail(res, '关联产品不存在');
  }

  application.status = body.approved ? 'approved' : 'rejected';
  application.reviewedAt = store.now();
  application.reviewerId = body.reviewerId;
  application.reviewerName = body.reviewerName;
  application.reviewComment = body.comment || '';

  store.addCirculationRecord(
    'approval',
    product.id,
    product.name,
    body.reviewerId,
    body.reviewerName,
    'reviewer',
    `${body.reviewerName} ${body.approved ? '通过' : '驳回'}了${application.applicantName}的「${product.name}」申请`,
    { applicationId: application.id, approved: body.approved, comment: body.comment }
  );

  if (body.approved) {
    const validDays = body.validDays ?? (application.type === 'trial' ? 7 : 365);
    const now = store.now();
    const expiresAt = addDays(now, validDays);

    const contract: Contract = {
      id: store.generateId(),
      applicationId: application.id,
      productId: product.id,
      productName: product.name,
      licensorId: product.ownerId,
      licensorName: product.ownerName,
      licenseeId: application.applicantId,
      licenseeName: application.applicantName,
      status: 'active',
      signedAt: now,
      expiresAt,
      pricingModel: product.pricingModel,
      unitPrice: product.price,
      totalCallsAllowed: application.type === 'trial' ? 100 : undefined,
      callsUsed: 0,
      amountPaid: 0,
    };

    store.contracts.set(contract.id, contract);
    application.contractId = contract.id;

    const token: AuthorizationToken = {
      id: store.generateId(),
      contractId: contract.id,
      productId: product.id,
      licenseeId: application.applicantId,
      token: generateToken(),
      issuedAt: now,
      expiresAt,
      isRevoked: false,
    };

    store.tokens.set(token.id, token);

    store.addCirculationRecord(
      'contract_sign',
      product.id,
      product.name,
      application.applicantId,
      application.applicantName,
      'consumer',
      `与${application.applicantName}签订产品「${product.name}」的授权合约`,
      { contractId: contract.id, validDays }
    );

    return success(
      res,
      { application, contract, token },
      '审批通过，合约和授权凭证已生成'
    );
  }

  return success(res, { application }, '审批完成');
});

router.post('/:id/cancel', (req: Request, res: Response) => {
  const { id } = req.params;
  const application = store.applications.get(id);

  if (!application) {
    return fail(res, '申请不存在');
  }
  if (application.status !== 'pending') {
    return fail(res, '仅待审批的申请可撤销');
  }

  application.status = 'cancelled';
  return success(res, application, '申请已撤销');
});

export default router;
