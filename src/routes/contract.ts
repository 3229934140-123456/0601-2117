import { Router, Request, Response } from 'express';
import { store } from '../store';
import { success, fail, paginate, generateToken, addDays } from '../utils';
import { Contract, AuthorizationToken, ContractStatus } from '../types';

const router = Router();

router.get('/list', (req: Request, res: Response) => {
  const { licenseeId, licensorId, productId, status, page, pageSize } = req.query;
  let contracts = Array.from(store.contracts.values());

  if (licenseeId) {
    contracts = contracts.filter((c) => c.licenseeId === licenseeId);
  }
  if (licensorId) {
    contracts = contracts.filter((c) => c.licensorId === licensorId);
  }
  if (productId) {
    contracts = contracts.filter((c) => c.productId === productId);
  }
  if (status) {
    const validStatuses: ContractStatus[] = ['active', 'expired', 'terminated', 'suspended'];
    if (validStatuses.includes(status as ContractStatus)) {
      contracts = contracts.filter((c) => c.status === status);
    }
  }

  contracts.sort((a, b) => new Date(b.signedAt).getTime() - new Date(a.signedAt).getTime());

  const result = paginate(contracts, Number(page), Number(pageSize));
  return success(res, result);
});

router.get('/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const contract = store.contracts.get(id);
  if (!contract) {
    return fail(res, '合约不存在', 404);
  }
  return success(res, contract);
});

router.put('/:id/status', (req: Request, res: Response) => {
  const { id } = req.params;
  const { status } = req.body as { status: ContractStatus };
  const contract = store.contracts.get(id);

  if (!contract) {
    return fail(res, '合约不存在', 404);
  }

  const validStatuses: ContractStatus[] = ['active', 'expired', 'terminated', 'suspended'];
  if (!validStatuses.includes(status)) {
    return fail(res, '无效的合约状态');
  }

  contract.status = status;

  if (status === 'terminated' || status === 'suspended') {
    store.tokens.forEach((t) => {
      if (t.contractId === id && !t.isRevoked) {
        t.isRevoked = true;
      }
    });
  }

  return success(res, contract, '合约状态已更新');
});

router.get('/:id/tokens', (req: Request, res: Response) => {
  const { id } = req.params;
  const tokens = Array.from(store.tokens.values()).filter((t) => t.contractId === id);
  return success(res, tokens);
});

router.post('/:id/refresh-token', (req: Request, res: Response) => {
  const { id } = req.params;
  const contract = store.contracts.get(id);

  if (!contract) {
    return fail(res, '合约不存在');
  }
  if (contract.status !== 'active') {
    return fail(res, '仅活跃状态的合约可刷新凭证');
  }

  const now = store.now();
  const expiresAt = contract.expiresAt > now ? contract.expiresAt : addDays(now, 30);

  const token: AuthorizationToken = {
    id: store.generateId(),
    contractId: contract.id,
    productId: contract.productId,
    licenseeId: contract.licenseeId,
    token: generateToken(),
    issuedAt: now,
    expiresAt,
    isRevoked: false,
  };

  store.tokens.set(token.id, token);
  return success(res, token, '新凭证已生成');
});

router.post('/token/revoke', (req: Request, res: Response) => {
  const { tokenId } = req.body as { tokenId: string };
  const token = store.tokens.get(tokenId);

  if (!token) {
    return fail(res, '凭证不存在');
  }

  token.isRevoked = true;
  return success(res, token, '凭证已撤销');
});

router.post('/verify-access', (req: Request, res: Response) => {
  const { token, productId, callerId } = req.body as {
    token: string;
    productId: string;
    callerId?: string;
  };

  if (!token || !productId) {
    return fail(res, '凭证和产品ID为必填项');
  }

  const tokenRecord = Array.from(store.tokens.values()).find((t) => t.token === token);

  if (!tokenRecord) {
    return fail(res, '凭证无效', 401);
  }
  if (tokenRecord.isRevoked) {
    return fail(res, '凭证已被撤销', 403);
  }
  if (tokenRecord.productId !== productId) {
    return fail(res, '凭证与产品不匹配', 403);
  }

  const now = new Date();
  if (new Date(tokenRecord.expiresAt) < now) {
    return fail(res, '凭证已过期', 403);
  }

  const contract = store.contracts.get(tokenRecord.contractId);
  if (!contract) {
    return fail(res, '关联合约不存在', 403);
  }
  if (contract.status !== 'active') {
    return fail(res, `合约状态异常：${contract.status}`, 403);
  }
  if (new Date(contract.expiresAt) < now) {
    contract.status = 'expired';
    return fail(res, '合约已过期', 403);
  }
  if (callerId && contract.licenseeId !== callerId) {
    return fail(res, '调用方与合约被许可方不一致', 403);
  }
  if (
    contract.totalCallsAllowed !== undefined &&
    contract.callsUsed >= contract.totalCallsAllowed
  ) {
    return fail(res, '调用次数已达上限', 429);
  }

  const product = store.products.get(productId);
  if (!product || product.status !== 'active') {
    return fail(res, '产品当前不可用', 403);
  }

  return success(
    res,
    {
      valid: true,
      contractId: contract.id,
      tokenId: tokenRecord.id,
      licenseeId: contract.licenseeId,
      remainingCalls:
        contract.totalCallsAllowed !== undefined
          ? contract.totalCallsAllowed - contract.callsUsed
          : null,
      expiresAt: tokenRecord.expiresAt,
    },
    '访问权限校验通过'
  );
});

export default router;
