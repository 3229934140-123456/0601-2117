import { Router, Request, Response } from 'express';
import { store } from '../store';
import { success, fail, paginate, getBillingPeriod } from '../utils';
import {
  UsageReportRequest,
  UsageRecord,
  BillSummary,
  BillDetailItem,
  BillDetailType,
  PricingModel,
} from '../types';

const router = Router();

function validateUsageReport(body: UsageReportRequest): { valid: boolean; error?: string } {
  if (!body.contractId) return { valid: false, error: '合约ID(contractId)为必填项' };
  if (!body.tokenId) return { valid: false, error: '凭证ID(tokenId)为必填项' };
  if (!body.productId) return { valid: false, error: '产品ID(productId)为必填项' };
  if (!body.callerId) return { valid: false, error: '调用方ID(callerId)为必填项' };
  if (body.callCount === undefined || body.callCount === null) {
    return { valid: false, error: '调用次数(callCount)为必填项' };
  }
  if (!Number.isInteger(body.callCount) || body.callCount < 0) {
    return { valid: false, error: '调用次数(callCount)必须是非负整数' };
  }
  const successCount = body.successCount ?? body.callCount;
  if (!Number.isInteger(successCount) || successCount < 0) {
    return { valid: false, error: '成功次数(successCount)必须是非负整数' };
  }
  if (successCount > body.callCount) {
    return { valid: false, error: '成功次数(successCount)不能大于调用总次数(callCount)' };
  }
  if (body.totalDataVolumeBytes !== undefined && body.totalDataVolumeBytes < 0) {
    return { valid: false, error: '数据量(totalDataVolumeBytes)不能为负数' };
  }
  return { valid: true };
}

function generateBillDetails(
  billId: string,
  pricingModel: PricingModel,
  unitPrice: number,
  callsDelta: number,
  volumeDeltaBytes: number,
  isNewBill: boolean
): BillDetailItem[] {
  const details: BillDetailItem[] = [];

  switch (pricingModel) {
    case 'per_call': {
      if (callsDelta > 0) {
        details.push({
          id: store.generateId(),
          billId,
          type: 'per_call_fee',
          description: '按次调用费用',
          quantity: callsDelta,
          unit: '次',
          unitPrice,
          subtotal: callsDelta * unitPrice,
          metadata: { unit: 'call' },
        });
      }
      break;
    }
    case 'per_volume': {
      const gbUsed = volumeDeltaBytes / (1024 * 1024 * 1024);
      if (gbUsed > 0) {
        details.push({
          id: store.generateId(),
          billId,
          type: 'per_volume_fee',
          description: '按流量使用费用',
          quantity: Number(gbUsed.toFixed(6)),
          unit: 'GB',
          unitPrice,
          subtotal: gbUsed * unitPrice,
          metadata: { bytes: volumeDeltaBytes },
        });
      }
      break;
    }
    case 'per_month': {
      if (isNewBill) {
        details.push({
          id: store.generateId(),
          billId,
          type: 'monthly_subscription',
          description: '月度订阅费',
          quantity: 1,
          unit: '月',
          unitPrice,
          subtotal: unitPrice,
        });
      }
      break;
    }
    case 'per_year': {
      if (isNewBill) {
        details.push({
          id: store.generateId(),
          billId,
          type: 'yearly_subscription',
          description: '年度订阅费',
          quantity: 1,
          unit: '年',
          unitPrice,
          subtotal: unitPrice,
        });
      }
      break;
    }
    case 'one_time': {
      if (isNewBill) {
        details.push({
          id: store.generateId(),
          billId,
          type: 'one_time_fee',
          description: '一次性授权费',
          quantity: 1,
          unit: '次',
          unitPrice,
          subtotal: unitPrice,
        });
      }
      break;
    }
  }

  return details;
}

router.post('/report', (req: Request, res: Response) => {
  const body = req.body as UsageReportRequest;

  const validation = validateUsageReport(body);
  if (!validation.valid) {
    return fail(res, validation.error!);
  }

  const contract = store.contracts.get(body.contractId);
  if (!contract) {
    return fail(res, `合约不存在: ${body.contractId}`);
  }
  if (contract.status !== 'active') {
    return fail(res, `合约状态异常: 当前为 ${contract.status}，仅 active 状态可回传用量`);
  }

  const token = store.tokens.get(body.tokenId);
  if (!token) {
    return fail(res, `凭证不存在: ${body.tokenId}`);
  }
  if (token.isRevoked) {
    return fail(res, '凭证已被撤销，无法回传用量');
  }

  const product = store.products.get(body.productId);
  if (!product) {
    return fail(res, `产品不存在: ${body.productId}`);
  }
  if (product.status !== 'active') {
    return fail(res, `产品当前不可用: status=${product.status}`);
  }

  if (token.contractId !== body.contractId) {
    return fail(
      res,
      `凭证与合约不匹配: token.contractId=${token.contractId}, 传入contractId=${body.contractId}`
    );
  }
  if (token.productId !== body.productId) {
    return fail(
      res,
      `凭证与产品不匹配: token.productId=${token.productId}, 传入productId=${body.productId}`
    );
  }
  if (token.licenseeId !== body.callerId) {
    return fail(
      res,
      `凭证调用方不匹配: token.licenseeId=${token.licenseeId}, 传入callerId=${body.callerId}`
    );
  }
  if (contract.productId !== body.productId) {
    return fail(
      res,
      `合约与产品不匹配: contract.productId=${contract.productId}, 传入productId=${body.productId}`
    );
  }
  if (contract.licenseeId !== body.callerId) {
    return fail(
      res,
      `合约调用方不匹配: contract.licenseeId=${contract.licenseeId}, 传入callerId=${body.callerId}`
    );
  }

  const now = store.now();
  const successCount = body.successCount ?? body.callCount;
  const avgResponseTime =
    body.callCount > 0 && body.totalResponseTimeMs !== undefined
      ? Math.floor(body.totalResponseTimeMs / body.callCount)
      : 0;
  const volumeDeltaBytes = body.totalDataVolumeBytes ?? 0;

  for (let i = 0; i < body.callCount; i++) {
    const record: UsageRecord = {
      id: store.generateId(),
      contractId: body.contractId,
      productId: body.productId,
      callerId: body.callerId,
      tokenId: body.tokenId,
      callTime: now,
      responseTimeMs: avgResponseTime,
      success: i < successCount,
      dataVolumeBytes:
        volumeDeltaBytes > 0 ? Math.floor(volumeDeltaBytes / body.callCount) : undefined,
    };
    store.usageRecords.unshift(record);
  }

  contract.callsUsed += body.callCount;
  contract.totalDataVolumeBytes += volumeDeltaBytes;

  const deltaAmount = store.calculateUsageAmount(
    contract.pricingModel,
    contract.unitPrice,
    body.callCount,
    volumeDeltaBytes
  );
  contract.accumulatedUsageAmount += deltaAmount;

  const period = getBillingPeriod(now);
  let existingBill = Array.from(store.bills.values()).find(
    (b) => b.contractId === body.contractId && b.billingPeriod === period
  );
  const isNewBill = !existingBill;

  if (isNewBill) {
    const dueDate = new Date(now);
    dueDate.setMonth(dueDate.getMonth() + 1);
    dueDate.setDate(15);

    const billId = store.generateId();
    const details = generateBillDetails(
      billId,
      contract.pricingModel,
      contract.unitPrice,
      body.callCount,
      volumeDeltaBytes,
      true
    );
    const detailTotal = details.reduce((sum, d) => sum + d.subtotal, 0);

    existingBill = {
      id: billId,
      contractId: body.contractId,
      productId: body.productId,
      productName: contract.productName,
      licenseeId: contract.licenseeId,
      licenseeName: contract.licenseeName,
      billingPeriod: period,
      pricingModel: contract.pricingModel,
      totalCalls: body.callCount,
      totalDataVolumeBytes: volumeDeltaBytes,
      unitPrice: contract.unitPrice,
      detailTotal: Number(detailTotal.toFixed(2)),
      totalAmount: Number(detailTotal.toFixed(2)),
      status: 'unpaid',
      generatedAt: now,
      dueDate: dueDate.toISOString().split('T')[0],
    };
    store.bills.set(billId, existingBill);
    store.billDetails.set(billId, details);
  } else {
    const currentBill = existingBill as BillSummary;
    currentBill.totalCalls += body.callCount;
    currentBill.totalDataVolumeBytes += volumeDeltaBytes;

    const prevDetails = store.billDetails.get(currentBill.id) || [];
    const newDetails = generateBillDetails(
      currentBill.id,
      contract.pricingModel,
      contract.unitPrice,
      body.callCount,
      volumeDeltaBytes,
      false
    );
    const mergedDetails = [...prevDetails];
    newDetails.forEach((nd) => {
      const sameType = mergedDetails.find((d) => d.type === nd.type);
      if (sameType) {
        sameType.quantity += nd.quantity;
        sameType.subtotal += nd.subtotal;
      } else {
        mergedDetails.push(nd);
      }
    });
    mergedDetails.forEach((d) => {
      d.subtotal = Number(d.subtotal.toFixed(6));
    });
    store.billDetails.set(currentBill.id, mergedDetails);

    const detailTotal = mergedDetails.reduce((sum, d) => sum + d.subtotal, 0);
    currentBill.detailTotal = Number(detailTotal.toFixed(2));
    currentBill.totalAmount = Number(detailTotal.toFixed(2));
  }

  store.addCirculationRecord(
    'usage',
    body.productId,
    product.name,
    body.callerId,
    contract.licenseeName,
    'consumer',
    `调用产品「${product.name}」共 ${body.callCount} 次，成功 ${successCount} 次`,
    {
      callCount: body.callCount,
      successCount,
      avgResponseTimeMs: avgResponseTime,
      dataVolumeBytes: volumeDeltaBytes,
      deltaAmount,
    },
    {
      contractId: body.contractId,
      tokenId: body.tokenId,
      billId: existingBill?.id,
    }
  );

  return success(
    res,
    {
      contractId: body.contractId,
      billId: existingBill?.id,
      billingPeriod: period,
      callsUsed: contract.callsUsed,
      totalDataVolumeBytes: contract.totalDataVolumeBytes,
      deltaCalls: body.callCount,
      deltaDataVolumeBytes: volumeDeltaBytes,
      deltaAmount: Number(deltaAmount.toFixed(4)),
      accumulatedUsageAmount: Number(contract.accumulatedUsageAmount.toFixed(4)),
      amountPaid: Number(contract.amountPaid.toFixed(4)),
      billTotalAmount: existingBill?.totalAmount ?? 0,
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

  const relatedBills = Array.from(store.bills.values()).filter(
    (b) => b.contractId === contractId
  );

  return success(res, {
    contractId,
    totalCalls,
    successCalls,
    failCalls: totalCalls - successCalls,
    avgResponseTimeMs: avgResponseTime,
    totalDataVolumeBytes: totalDataVolume,
    callsAllowed: contract.totalCallsAllowed,
    callsUsed: contract.callsUsed,
    accumulatedUsageAmount: Number(contract.accumulatedUsageAmount.toFixed(4)),
    amountPaid: Number(contract.amountPaid.toFixed(4)),
    billCount: relatedBills.length,
    unpaidBills: relatedBills.filter((b) => b.status === 'unpaid').length,
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
  const detailTotalCheck = bills.reduce((sum, b) => sum + b.detailTotal, 0);
  const unpaidAmount = bills
    .filter((b) => b.status === 'unpaid')
    .reduce((sum, b) => sum + b.totalAmount, 0);
  const paidAmount = bills
    .filter((b) => b.status === 'paid')
    .reduce((sum, b) => sum + b.totalAmount, 0);
  const overdueAmount = bills
    .filter((b) => b.status === 'overdue')
    .reduce((sum, b) => sum + b.totalAmount, 0);

  return success(res, {
    totalCount,
    totalAmount: Number(totalAmount.toFixed(2)),
    detailTotalCheck: Number(detailTotalCheck.toFixed(2)),
    amountConsistent: Math.abs(totalAmount - detailTotalCheck) < 0.01,
    unpaidAmount: Number(unpaidAmount.toFixed(2)),
    paidAmount: Number(paidAmount.toFixed(2)),
    overdueAmount: Number(overdueAmount.toFixed(2)),
    byPeriod: bills.reduce((acc: Record<string, number>, b) => {
      acc[b.billingPeriod] = Number(((acc[b.billingPeriod] || 0) + b.totalAmount).toFixed(2));
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
  const details = store.billDetails.get(id) || [];
  const detailSum = details.reduce((sum, d) => sum + d.subtotal, 0);
  return success(res, {
    summary: bill,
    details,
    detailTotal: Number(detailSum.toFixed(2)),
    matchesSummary: Math.abs(detailSum - bill.detailTotal) < 0.01,
  });
});

router.get('/bills/:id/details', (req: Request, res: Response) => {
  const { id } = req.params;
  const bill = store.bills.get(id);
  if (!bill) {
    return fail(res, '账单不存在', 404);
  }
  const details = store.billDetails.get(id) || [];
  return success(res, {
    billId: id,
    pricingModel: bill.pricingModel,
    totalAmount: bill.totalAmount,
    details,
    detailTotal: Number(details.reduce((sum, d) => sum + d.subtotal, 0).toFixed(2)),
  });
});

router.post('/bills/:id/pay', (req: Request, res: Response) => {
  const { id } = req.params;
  const bill = store.bills.get(id);

  if (!bill) {
    return fail(res, '账单不存在');
  }
  if (bill.status === 'paid') {
    return fail(res, '账单已支付，请勿重复操作');
  }

  const prevStatus = bill.status;
  bill.status = 'paid';
  bill.paidAt = store.now();

  const contract = store.contracts.get(bill.contractId);
  let contractAmountPaidBefore = 0;
  if (contract) {
    contractAmountPaidBefore = contract.amountPaid;
    contract.amountPaid += bill.totalAmount;
  }

  const product = store.products.get(bill.productId);
  if (product) {
    store.addCirculationRecord(
      'bill_pay',
      bill.productId,
      product.name,
      bill.licenseeId,
      bill.licenseeName,
      'consumer',
      `${bill.licenseeName} 支付账单 ${bill.billingPeriod}，金额 ¥${bill.totalAmount.toFixed(2)}`,
      {
        billingPeriod: bill.billingPeriod,
        amount: bill.totalAmount,
        prevStatus,
      },
      {
        contractId: bill.contractId,
        billId: bill.id,
      }
    );
  }

  return success(
    res,
    {
      billId: bill.id,
      status: bill.status,
      paidAt: bill.paidAt,
      totalAmount: bill.totalAmount,
      contractAmountPaidBefore: Number(contractAmountPaidBefore.toFixed(4)),
      contractAmountPaidAfter: contract ? Number(contract.amountPaid.toFixed(4)) : 0,
      amountIncrement: contract ? Number(bill.totalAmount.toFixed(4)) : 0,
    },
    '账单支付成功'
  );
});

export default router;
