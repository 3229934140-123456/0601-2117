import { Router, Request, Response } from 'express';
import { store } from '../store';
import { success, fail, paginate, getBillingPeriod } from '../utils';
import { UsageReportRequest, UsageRecord, BillSummary } from '../types';

const router = Router();

router.post('/report', (req: Request, res: Response) => {
  const body = req.body as UsageReportRequest;

  if (
    !body.contractId ||
    !body.tokenId ||
    !body.productId ||
    !body.callerId ||
    body.callCount === undefined
  ) {
    return fail(res, '合约ID、凭证ID、产品ID、调用方ID和调用次数为必填项');
  }

  const contract = store.contracts.get(body.contractId);
  if (!contract) {
    return fail(res, '合约不存在');
  }
  if (contract.status !== 'active') {
    return fail(res, '合约非活跃状态，无法回传用量');
  }

  const token = store.tokens.get(body.tokenId);
  if (!token) {
    return fail(res, '凭证不存在');
  }
  if (token.isRevoked) {
    return fail(res, '凭证已撤销，无法回传用量');
  }

  const now = store.now();
  const avgResponseTime =
    body.callCount > 0 && body.totalResponseTimeMs !== undefined
      ? Math.floor(body.totalResponseTimeMs / body.callCount)
      : 0;

  for (let i = 0; i < body.callCount; i++) {
    const record: UsageRecord = {
      id: store.generateId(),
      contractId: body.contractId,
      productId: body.productId,
      callerId: body.callerId,
      tokenId: body.tokenId,
      callTime: now,
      responseTimeMs: avgResponseTime,
      success: i < (body.successCount ?? body.callCount),
      dataVolumeBytes: body.totalDataVolumeBytes
        ? Math.floor(body.totalDataVolumeBytes / body.callCount)
        : undefined,
    };
    store.usageRecords.unshift(record);
  }

  contract.callsUsed += body.callCount;

  if (contract.pricingModel === 'per_call') {
    contract.amountPaid = contract.callsUsed * contract.unitPrice;
  } else if (contract.pricingModel === 'per_volume' && body.totalDataVolumeBytes) {
    const gbUsed = body.totalDataVolumeBytes / (1024 * 1024 * 1024);
    contract.amountPaid += gbUsed * contract.unitPrice;
  }

  const period = getBillingPeriod(now);
  const existingBill = Array.from(store.bills.values()).find(
    (b) => b.contractId === body.contractId && b.billingPeriod === period
  );

  if (!existingBill) {
    const dueDate = new Date(now);
    dueDate.setMonth(dueDate.getMonth() + 1);
    dueDate.setDate(15);

    const bill: BillSummary = {
      id: store.generateId(),
      contractId: body.contractId,
      productId: body.productId,
      productName: contract.productName,
      licenseeId: contract.licenseeId,
      licenseeName: contract.licenseeName,
      billingPeriod: period,
      totalCalls: body.callCount,
      unitPrice: contract.unitPrice,
      totalAmount: contract.pricingModel === 'per_call' ? body.callCount * contract.unitPrice : 0,
      status: 'unpaid',
      generatedAt: now,
      dueDate: dueDate.toISOString().split('T')[0],
    };
    store.bills.set(bill.id, bill);
  } else {
    existingBill.totalCalls += body.callCount;
    if (contract.pricingModel === 'per_call') {
      existingBill.totalAmount = existingBill.totalCalls * existingBill.unitPrice;
    }
  }

  const product = store.products.get(body.productId);
  if (product) {
    store.addCirculationRecord(
      'usage',
      body.productId,
      product.name,
      body.callerId,
      '',
      'consumer',
      `调用产品「${product.name}」共 ${body.callCount} 次`,
      {
        contractId: body.contractId,
        callCount: body.callCount,
        successCount: body.successCount ?? body.callCount,
      }
    );
  }

  return success(
    res,
    {
      contractId: body.contractId,
      totalCallsUsed: contract.callsUsed,
      amountPaid: contract.amountPaid,
    },
    '用量回传成功'
  );
});

router.get('/records', (req: Request, res: Response) => {
  const { contractId, productId, callerId, startTime, endTime, page, pageSize } = req.query;
  let records = [...store.usageRecords];

  if (contractId) {
    records = records.filter((r) => r.contractId === contractId);
  }
  if (productId) {
    records = records.filter((r) => r.productId === productId);
  }
  if (callerId) {
    records = records.filter((r) => r.callerId === callerId);
  }
  if (startTime) {
    const start = new Date(startTime as string);
    records = records.filter((r) => new Date(r.callTime) >= start);
  }
  if (endTime) {
    const end = new Date(endTime as string);
    records = records.filter((r) => new Date(r.callTime) <= end);
  }

  const result = paginate(records, Number(page), Number(pageSize));
  return success(res, result);
});

router.get('/contract/:contractId/stats', (req: Request, res: Response) => {
  const { contractId } = req.params;
  const contract = store.contracts.get(contractId);

  if (!contract) {
    return fail(res, '合约不存在');
  }

  const records = store.usageRecords.filter((r) => r.contractId === contractId);
  const totalCalls = records.length;
  const successCalls = records.filter((r) => r.success).length;
  const avgResponseTime =
    totalCalls > 0
      ? Math.floor(records.reduce((sum, r) => sum + r.responseTimeMs, 0) / totalCalls)
      : 0;
  const totalDataVolume = records.reduce((sum, r) => sum + (r.dataVolumeBytes || 0), 0);

  return success(res, {
    contractId,
    totalCalls,
    successCalls,
    failCalls: totalCalls - successCalls,
    avgResponseTimeMs: avgResponseTime,
    totalDataVolumeBytes: totalDataVolume,
    callsAllowed: contract.totalCallsAllowed,
    callsUsed: contract.callsUsed,
    amountPaid: contract.amountPaid,
  });
});

router.get('/bills', (req: Request, res: Response) => {
  const { licenseeId, contractId, productId, billingPeriod, status, page, pageSize } = req.query;
  let bills = Array.from(store.bills.values());

  if (licenseeId) {
    bills = bills.filter((b) => b.licenseeId === licenseeId);
  }
  if (contractId) {
    bills = bills.filter((b) => b.contractId === contractId);
  }
  if (productId) {
    bills = bills.filter((b) => b.productId === productId);
  }
  if (billingPeriod) {
    bills = bills.filter((b) => b.billingPeriod === billingPeriod);
  }
  if (status) {
    const validStatuses: BillSummary['status'][] = ['unpaid', 'paid', 'overdue'];
    if (validStatuses.includes(status as BillSummary['status'])) {
      bills = bills.filter((b) => b.status === status);
    }
  }

  bills.sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime());

  const result = paginate(bills, Number(page), Number(pageSize));
  return success(res, result);
});

router.get('/bills/summary', (req: Request, res: Response) => {
  const { licenseeId } = req.query;
  let bills = Array.from(store.bills.values());

  if (licenseeId) {
    bills = bills.filter((b) => b.licenseeId === licenseeId);
  }

  const totalCount = bills.length;
  const totalAmount = bills.reduce((sum, b) => sum + b.totalAmount, 0);
  const unpaidAmount = bills.filter((b) => b.status === 'unpaid').reduce((sum, b) => sum + b.totalAmount, 0);
  const paidAmount = bills.filter((b) => b.status === 'paid').reduce((sum, b) => sum + b.totalAmount, 0);
  const overdueAmount = bills.filter((b) => b.status === 'overdue').reduce((sum, b) => sum + b.totalAmount, 0);

  return success(res, {
    totalCount,
    totalAmount,
    unpaidAmount,
    paidAmount,
    overdueAmount,
    byPeriod: bills.reduce((acc: Record<string, number>, b) => {
      acc[b.billingPeriod] = (acc[b.billingPeriod] || 0) + b.totalAmount;
      return acc;
    }, {}),
  });
});

router.get('/bills/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const bill = store.bills.get(id);
  if (!bill) {
    return fail(res, '账单不存在', 404);
  }
  return success(res, bill);
});

router.post('/bills/:id/pay', (req: Request, res: Response) => {
  const { id } = req.params;
  const bill = store.bills.get(id);

  if (!bill) {
    return fail(res, '账单不存在');
  }
  if (bill.status === 'paid') {
    return fail(res, '账单已支付');
  }

  bill.status = 'paid';
  bill.paidAt = store.now();

  const contract = store.contracts.get(bill.contractId);
  if (contract) {
    contract.amountPaid += bill.totalAmount;
  }

  return success(res, bill, '账单已支付');
});

export default router;
