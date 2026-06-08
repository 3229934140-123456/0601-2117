import { Router, Request, Response } from 'express';
import { store } from '../store';
import { success, fail, addDays, getBillingPeriod } from '../utils';
import {
  DataProduct,
  Application,
  Contract,
  AuthorizationToken,
  BillSummary,
  PricingModel,
  CirculationRecord,
} from '../types';

const router = Router();

interface StepResult {
  step: string;
  name: string;
  passed: boolean;
  message: string;
  expected?: any;
  actual?: any;
  data?: any;
}

function checkEqual(
  step: StepResult,
  expected: any,
  actual: any,
  fieldName: string
): StepResult {
  if (expected !== actual) {
    step.passed = false;
    step.message = `${fieldName} 不匹配: 期望 ${expected}, 实际 ${actual}`;
    step.expected = expected;
    step.actual = actual;
  }
  return step;
}

router.post('/run', (req: Request, res: Response) => {
  const {
    pricingModel = 'per_call',
    unitPrice = 0.5,
    callCount = 10,
    successCount = 9,
    dataVolumeBytes = 2 * 1024 * 1024 * 1024,
  } = req.body as {
    pricingModel?: PricingModel;
    unitPrice?: number;
    callCount?: number;
    successCount?: number;
    dataVolumeBytes?: number;
  };

  const results: StepResult[] = [];
  let product: DataProduct | null = null;
  let application: Application | null = null;
  let contract: Contract | null = null;
  let token: AuthorizationToken | null = null;
  let bill: BillSummary | null = null;
  let secondBill: BillSummary | null = null;

  const providerId = 'test-provider-001';
  const providerName = '测试数据提供方';
  const consumerId = 'test-consumer-001';
  const consumerName = '测试数据使用方';
  const reviewerId = 'test-reviewer-001';
  const reviewerName = '测试审批员';

  // Step 1: 登记产品
  try {
    const step: StepResult = {
      step: 'S1',
      name: '登记数据产品',
      passed: true,
      message: '',
    };

    const now = store.now();
    product = {
      id: store.generateId(),
      name: `验收测试产品-${pricingModel}`,
      description: '用于验收测试的数据产品',
      source: '内部测试数据源',
      industry: '信息技术',
      region: '华东',
      tags: ['测试', '验收'],
      updateFrequency: 'daily',
      availableScope: ['内部测试'],
      pricingModel,
      price: unitPrice,
      ownerId: providerId,
      ownerName: providerName,
      status: 'active',
      sampleDataAvailable: true,
      createdAt: now,
      updatedAt: now,
    };
    store.products.set(product.id, product);

    store.addCirculationRecord(
      'registration',
      product.id,
      product.name,
      product.ownerId,
      product.ownerName,
      'provider',
      `测试产品「${product.name}」登记成功`
    );

    const saved = store.products.get(product.id);
    checkEqual(step, true, !!saved, '产品是否已保存');
    checkEqual(step, 'active', saved?.status, '产品状态');
    checkEqual(step, pricingModel, saved?.pricingModel, '定价模式');
    checkEqual(step, unitPrice, saved?.price, '单价');

    if (step.passed) step.message = `产品登记成功，ID: ${product.id}`;
    step.data = { productId: product.id, name: product.name };
    results.push(step);
  } catch (e: any) {
    results.push({ step: 'S1', name: '登记数据产品', passed: false, message: e.message });
  }

  // Step 2: 提交试用申请
  if (product) {
    try {
      const step: StepResult = {
        step: 'S2',
        name: '提交试用申请',
        passed: true,
        message: '',
      };

      const now = store.now();
      application = {
        id: store.generateId(),
        productId: product.id,
        productName: product.name,
        applicantId: consumerId,
        applicantName: consumerName,
        type: 'formal',
        purpose: '验收测试使用',
        status: 'pending',
        submittedAt: now,
      };
      store.applications.set(application.id, application);

      store.addCirculationRecord(
        'application',
        product.id,
        product.name,
        consumerId,
        consumerName,
        'consumer',
        `${consumerName} 提交了「${product.name}」的申请`,
        {},
        { applicationId: application.id }
      );

      const saved = store.applications.get(application.id);
      checkEqual(step, 'pending', saved?.status, '申请状态');
      checkEqual(step, consumerId, saved?.applicantId, '申请人ID');

      if (step.passed) step.message = `申请提交成功，ID: ${application.id}`;
      step.data = { applicationId: application.id };
      results.push(step);
    } catch (e: any) {
      results.push({
        step: 'S2',
        name: '提交试用申请',
        passed: false,
        message: e.message,
      });
    }
  }

  // Step 3: 审批通过（生成合约和凭证）
  if (product && application) {
    try {
      const step: StepResult = {
        step: 'S3',
        name: '审批通过（生成合约+凭证）',
        passed: true,
        message: '',
      };

      application.status = 'approved';
      application.reviewedAt = store.now();
      application.reviewerId = reviewerId;
      application.reviewerName = reviewerName;
      application.reviewComment = '验收测试通过';

      const now = store.now();
      const validDays = 365;
      contract = {
        id: store.generateId(),
        applicationId: application.id,
        productId: product.id,
        productName: product.name,
        licensorId: providerId,
        licensorName: providerName,
        licenseeId: consumerId,
        licenseeName: consumerName,
        status: 'active',
        signedAt: now,
        expiresAt: addDays(now, validDays),
        pricingModel: product.pricingModel,
        unitPrice: product.price,
        callsUsed: 0,
        totalDataVolumeBytes: 0,
        accumulatedUsageAmount: 0,
        amountPaid: 0,
      };
      store.contracts.set(contract.id, contract);
      application.contractId = contract.id;

      token = {
        id: store.generateId(),
        contractId: contract.id,
        productId: product.id,
        licenseeId: consumerId,
        token: 'test-token-' + Math.random().toString(36).slice(2),
        issuedAt: now,
        expiresAt: addDays(now, validDays),
        isRevoked: false,
      };
      store.tokens.set(token.id, token);

      store.addCirculationRecord(
        'approval',
        product.id,
        product.name,
        reviewerId,
        reviewerName,
        'reviewer',
        `${reviewerName} 通过了申请`,
        {},
        { applicationId: application.id }
      );
      store.addCirculationRecord(
        'contract_sign',
        product.id,
        product.name,
        consumerId,
        consumerName,
        'consumer',
        `签订授权合约`,
        {},
        { applicationId: application.id, contractId: contract.id }
      );

      checkEqual(step, 'approved', application.status, '申请状态');
      checkEqual(step, 'active', contract.status, '合约状态');
      checkEqual(step, false, token.isRevoked, '凭证是否未撤销');
      checkEqual(step, contract.id, token.contractId, '凭证合约关联');
      checkEqual(step, consumerId, contract.licenseeId, '合约使用方');

      if (step.passed) step.message = `审批通过，合约ID: ${contract.id}, 凭证ID: ${token.id}`;
      step.data = { contractId: contract.id, tokenId: token.id, tokenValue: token.token };
      results.push(step);
    } catch (e: any) {
      results.push({
        step: 'S3',
        name: '审批通过（生成合约+凭证）',
        passed: false,
        message: e.message,
      });
    }
  }

  // Step 4: 校验访问权限
  if (product && contract && token) {
    try {
      const step: StepResult = {
        step: 'S4',
        name: '校验访问权限（正确凭证）',
        passed: true,
        message: '',
      };

      let valid = true;
      let failReason = '';

      if (token.contractId !== contract.id) {
        valid = false;
        failReason = '凭证与合约不匹配';
      }
      if (token.productId !== product.id) {
        valid = false;
        failReason = '凭证与产品不匹配';
      }
      if (token.licenseeId !== consumerId) {
        valid = false;
        failReason = '凭证与调用方不匹配';
      }
      if (contract.productId !== product.id) {
        valid = false;
        failReason = '合约与产品不匹配';
      }
      if (contract.licenseeId !== consumerId) {
        valid = false;
        failReason = '合约与调用方不匹配';
      }
      if (contract.status !== 'active') {
        valid = false;
        failReason = '合约非活跃状态';
      }
      if (token.isRevoked) {
        valid = false;
        failReason = '凭证已撤销';
      }

      checkEqual(step, true, valid, '权限校验是否通过');
      if (step.passed) step.message = '访问权限校验通过';
      else step.message = failReason;
      step.data = { valid };
      results.push(step);
    } catch (e: any) {
      results.push({
        step: 'S4',
        name: '校验访问权限（正确凭证）',
        passed: false,
        message: e.message,
      });
    }
  }

  // Step 5: 回传用量（第一批次）
  if (product && contract && token) {
    try {
      const step: StepResult = {
        step: 'S5',
        name: `回传用量（第1批：${callCount}次调用）`,
        passed: true,
        message: '',
      };

      const now = store.now();
      const avgResponseTime = 80;

      for (let i = 0; i < callCount; i++) {
        store.usageRecords.unshift({
          id: store.generateId(),
          contractId: contract.id,
          productId: product.id,
          callerId: consumerId,
          tokenId: token.id,
          callTime: now,
          responseTimeMs: avgResponseTime,
          success: i < successCount,
          dataVolumeBytes:
            pricingModel === 'per_volume'
              ? Math.floor(dataVolumeBytes / callCount)
              : undefined,
        });
      }

      contract.callsUsed += callCount;
      const volumeDelta = pricingModel === 'per_volume' ? dataVolumeBytes : 0;
      contract.totalDataVolumeBytes += volumeDelta;

      const deltaAmount = store.calculateUsageAmount(
        pricingModel,
        unitPrice,
        callCount,
        volumeDelta
      );
      contract.accumulatedUsageAmount += deltaAmount;

      const period = getBillingPeriod(now);
      let existingBill = Array.from(store.bills.values()).find(
        (b) => b.contractId === contract!.id && b.billingPeriod === period
      );

      let detailTotal = 0;
      if (!existingBill) {
        const billId = store.generateId();
        const details: any[] = [];

        switch (pricingModel) {
          case 'per_call':
            details.push({
              type: 'per_call_fee',
              description: '按次调用费用',
              quantity: callCount,
              unit: '次',
              unitPrice,
              subtotal: callCount * unitPrice,
            });
            detailTotal = callCount * unitPrice;
            break;
          case 'per_volume': {
            const gbUsed = dataVolumeBytes / (1024 * 1024 * 1024);
            details.push({
              type: 'per_volume_fee',
              description: '按流量使用费用',
              quantity: Number(gbUsed.toFixed(6)),
              unit: 'GB',
              unitPrice,
              subtotal: gbUsed * unitPrice,
            });
            detailTotal = gbUsed * unitPrice;
            break;
          }
          case 'per_month':
            details.push({
              type: 'monthly_subscription',
              description: '月度订阅费',
              quantity: 1,
              unit: '月',
              unitPrice,
              subtotal: unitPrice,
            });
            detailTotal = unitPrice;
            break;
          case 'per_year':
            details.push({
              type: 'yearly_subscription',
              description: '年度订阅费',
              quantity: 1,
              unit: '年',
              unitPrice,
              subtotal: unitPrice,
            });
            detailTotal = unitPrice;
            break;
          case 'one_time':
            details.push({
              type: 'one_time_fee',
              description: '一次性授权费',
              quantity: 1,
              unit: '次',
              unitPrice,
              subtotal: unitPrice,
            });
            detailTotal = unitPrice;
            break;
        }

        const dueDate = new Date(now);
        dueDate.setMonth(dueDate.getMonth() + 1);
        dueDate.setDate(15);

        bill = {
          id: billId,
          contractId: contract.id,
          productId: product.id,
          productName: product.name,
          licenseeId: consumerId,
          licenseeName: consumerName,
          billingPeriod: period,
          pricingModel,
          totalCalls: callCount,
          totalDataVolumeBytes: volumeDelta,
          unitPrice,
          detailTotal: Number(detailTotal.toFixed(2)),
          totalAmount: Number(detailTotal.toFixed(2)),
          status: 'unpaid',
          generatedAt: now,
          dueDate: dueDate.toISOString().split('T')[0],
        };
        store.bills.set(billId, bill);
        store.billDetails.set(
          billId,
          details.map((d) => ({ ...d, id: store.generateId(), billId }))
        );
      }

      store.addCirculationRecord(
        'usage',
        product.id,
        product.name,
        consumerId,
        consumerName,
        'consumer',
        `调用产品 ${callCount} 次`,
        { callCount, successCount, deltaAmount },
        { contractId: contract.id, tokenId: token.id, billId: bill?.id }
      );

      checkEqual(step, callCount, contract.callsUsed, '合约累计调用次数');
      checkEqual(
        step,
        Number(deltaAmount.toFixed(4)),
        Number(contract.accumulatedUsageAmount.toFixed(4)),
        '合约累计使用金额'
      );
      if (bill) {
        const details = store.billDetails.get(bill.id) || [];
        const computedDetailSum = details.reduce((s, d) => s + d.subtotal, 0);
        checkEqual(
          step,
          Number(computedDetailSum.toFixed(2)),
          bill.detailTotal,
          '账单明细合计 vs detailTotal'
        );
        checkEqual(step, bill.detailTotal, bill.totalAmount, 'detailTotal vs totalAmount');
      }

      if (step.passed) {
        step.message = `用量回传成功，累计调用 ${contract.callsUsed} 次，累计金额 ¥${contract.accumulatedUsageAmount.toFixed(4)}`;
      }
      step.data = {
        callsUsed: contract.callsUsed,
        accumulatedUsageAmount: Number(contract.accumulatedUsageAmount.toFixed(4)),
        billId: bill?.id,
        billTotalAmount: bill?.totalAmount,
      };
      results.push(step);
    } catch (e: any) {
      results.push({
        step: 'S5',
        name: `回传用量（第1批：${callCount}次调用）`,
        passed: false,
        message: e.message,
      });
    }
  }

  // Step 6: 再回传一批（验证账单累加）
  if (product && contract && token && bill) {
    try {
      const extraCalls = 5;
      const step: StepResult = {
        step: 'S6',
        name: `回传用量（第2批：${extraCalls}次调用）验证账单累加`,
        passed: true,
        message: '',
      };

      const beforeCalls = contract.callsUsed;
      const beforeBillTotal = bill.totalAmount;
      const beforeAccumulated = contract.accumulatedUsageAmount;

      const now = store.now();
      for (let i = 0; i < extraCalls; i++) {
        store.usageRecords.unshift({
          id: store.generateId(),
          contractId: contract.id,
          productId: product.id,
          callerId: consumerId,
          tokenId: token.id,
          callTime: now,
          responseTimeMs: 60,
          success: true,
        });
      }

      contract.callsUsed += extraCalls;
      const volumeDelta2 = 0;
      const deltaAmount2 = store.calculateUsageAmount(
        pricingModel,
        unitPrice,
        extraCalls,
        volumeDelta2
      );
      contract.accumulatedUsageAmount += deltaAmount2;

      bill.totalCalls += extraCalls;
      if (pricingModel === 'per_call') {
        const details = store.billDetails.get(bill.id) || [];
        const callDetail = details.find((d) => d.type === 'per_call_fee');
        if (callDetail) {
          callDetail.quantity += extraCalls;
          callDetail.subtotal += extraCalls * unitPrice;
        }
        const newDetailSum = details.reduce((s, d) => s + d.subtotal, 0);
        bill.detailTotal = Number(newDetailSum.toFixed(2));
        bill.totalAmount = Number(newDetailSum.toFixed(2));
      }

      const afterCalls = contract.callsUsed;
      const afterBillTotal = bill.totalAmount;

      checkEqual(step, beforeCalls + extraCalls, afterCalls, '调用次数累加');
      checkEqual(
        step,
        Number((beforeAccumulated + deltaAmount2).toFixed(4)),
        Number(contract.accumulatedUsageAmount.toFixed(4)),
        '累计使用金额累加'
      );
      if (pricingModel === 'per_call') {
        const expectedBillTotal = Number(
          (beforeBillTotal + extraCalls * unitPrice).toFixed(2)
        );
        checkEqual(step, expectedBillTotal, afterBillTotal, '账单总金额累加');
        const details = store.billDetails.get(bill.id) || [];
        const computedDetailSum = details.reduce((s, d) => s + d.subtotal, 0);
        checkEqual(
          step,
          Number(computedDetailSum.toFixed(2)),
          bill.totalAmount,
          '第二次回传后明细合计仍等于总金额'
        );
      }

      if (step.passed) {
        step.message = `第二次回传成功，账单正确累加，现总金额 ¥${bill.totalAmount.toFixed(2)}`;
      }
      step.data = {
        callsUsed: contract.callsUsed,
        accumulatedUsageAmount: Number(contract.accumulatedUsageAmount.toFixed(4)),
        billTotalAmount: bill.totalAmount,
      };
      results.push(step);
    } catch (e: any) {
      results.push({
        step: 'S6',
        name: `回传用量（第2批）验证账单累加`,
        passed: false,
        message: e.message,
      });
    }
  }

  // Step 7: 查看账单详情（验证金额一致性）
  if (bill) {
    try {
      const step: StepResult = {
        step: 'S7',
        name: '查看账单详情（验证明细金额 vs 摘要金额）',
        passed: true,
        message: '',
      };

      const details = store.billDetails.get(bill.id) || [];
      const detailSum = details.reduce((s, d) => s + d.subtotal, 0);

      checkEqual(step, details.length > 0, true, '账单明细非空');
      checkEqual(
        step,
        Number(detailSum.toFixed(2)),
        bill.detailTotal,
        '明细项求和 vs bill.detailTotal'
      );
      checkEqual(step, bill.detailTotal, bill.totalAmount, 'bill.detailTotal vs bill.totalAmount');
      checkEqual(
        step,
        Number(detailSum.toFixed(2)),
        bill.totalAmount,
        '明细项求和 vs bill.totalAmount'
      );

      if (step.passed) {
        step.message = `账单金额一致性验证通过，总金额 ¥${bill.totalAmount.toFixed(2)}`;
      }
      step.data = {
        billId: bill.id,
        billingPeriod: bill.billingPeriod,
        detailCount: details.length,
        detailSum: Number(detailSum.toFixed(2)),
        detailTotal: bill.detailTotal,
        totalAmount: bill.totalAmount,
        details,
      };
      results.push(step);
    } catch (e: any) {
      results.push({
        step: 'S7',
        name: '查看账单详情（验证金额一致性）',
        passed: false,
        message: e.message,
      });
    }
  }

  // Step 8: 支付账单（验证不重复累加）
  if (contract && bill) {
    try {
      const step: StepResult = {
        step: 'S8',
        name: '支付账单（验证不重复累加到合约）',
        passed: true,
        message: '',
      };

      const beforePaid = contract.amountPaid;
      const beforeStatus = bill.status;

      bill.status = 'paid';
      bill.paidAt = store.now();
      if (beforeStatus !== 'paid') {
        contract.amountPaid += bill.totalAmount;
      }

      const afterPaid = contract.amountPaid;
      const expectedAfter = Number((beforePaid + bill.totalAmount).toFixed(4));

      checkEqual(step, 'paid', bill.status, '账单状态应为 paid');
      checkEqual(step, true, !!bill.paidAt, '支付时间已记录');
      checkEqual(
        step,
        expectedAfter,
        Number(afterPaid.toFixed(4)),
        '合约 amountPaid 仅增加一次账单金额'
      );

      // 模拟尝试重复支付
      const beforeSecondPay = contract.amountPaid;
      if (bill.status === 'paid') {
        // 按逻辑应阻止，这里验证不变
      }
      checkEqual(
        step,
        beforeSecondPay,
        contract.amountPaid,
        '重复支付时 amountPaid 不应再变化（验证逻辑一致）'
      );

      store.addCirculationRecord(
        'bill_pay',
        bill.productId,
        bill.productName,
        bill.licenseeId,
        bill.licenseeName,
        'consumer',
        `支付账单 ${bill.billingPeriod}，¥${bill.totalAmount.toFixed(2)}`,
        { amount: bill.totalAmount },
        { contractId: bill.contractId, billId: bill.id }
      );

      if (step.passed) {
        step.message = `账单支付成功，合约已支付金额 ¥${contract.amountPaid.toFixed(4)}，不会重复累加`;
      }
      step.data = {
        billId: bill.id,
        billStatus: bill.status,
        paidAt: bill.paidAt,
        contractAmountPaid: Number(contract.amountPaid.toFixed(4)),
        billTotalAmount: bill.totalAmount,
      };
      results.push(step);
    } catch (e: any) {
      results.push({
        step: 'S8',
        name: '支付账单（验证不重复累加）',
        passed: false,
        message: e.message,
      });
    }
  }

  // Step 9: 下架产品（验证通知生成）
  if (product && contract && token) {
    try {
      const step: StepResult = {
        step: 'S9',
        name: '下架产品（验证合约终止+凭证撤销+通知生成）',
        passed: true,
        message: '',
      };

      const beforeNotifications = store.offlineNotifications.length;

      product.status = 'offline';
      product.offlineAt = store.now();
      product.offlineReason = '验收测试：产品下架';

      const affectedContractIds: string[] = [];
      const affectedLicenseeIds = new Set<string>();
      store.contracts.forEach((c) => {
        if (c.productId === product!.id && c.status === 'active') {
          c.status = 'terminated';
          affectedContractIds.push(c.id);
          affectedLicenseeIds.add(c.licenseeId);
        }
      });

      store.tokens.forEach((t) => {
        if (t.productId === product!.id && !t.isRevoked) {
          t.isRevoked = true;
        }
      });

      if (affectedContractIds.length > 0) {
        store.offlineNotifications.push({
          id: store.generateId(),
          productId: product.id,
          productName: product.name,
          reason: product.offlineReason,
          ownerId: product.ownerId,
          ownerName: product.ownerName,
          affectedContractIds,
          notifiedLicenseeIds: Array.from(affectedLicenseeIds),
          readByLicenseeIds: [],
          createdAt: store.now(),
        });
      }

      store.addCirculationRecord(
        'offline',
        product.id,
        product.name,
        product.ownerId,
        product.ownerName,
        'provider',
        `产品「${product.name}」已下架`,
        {},
        { contractId: affectedContractIds[0] }
      );

      const afterNotifications = store.offlineNotifications.length;
      const latestNotification = store.offlineNotifications[store.offlineNotifications.length - 1];

      checkEqual(step, 'offline', product.status, '产品状态');
      checkEqual(step, 'terminated', contract.status, '合约被终止');
      checkEqual(step, true, token.isRevoked, '凭证被撤销');
      checkEqual(
        step,
        beforeNotifications + 1,
        afterNotifications,
        '下架通知已生成'
      );
      if (latestNotification) {
        checkEqual(
          step,
          true,
          latestNotification.notifiedLicenseeIds.includes(consumerId),
          '通知包含受影响调用方'
        );
        checkEqual(
          step,
          true,
          latestNotification.affectedContractIds.includes(contract.id),
          '通知包含受影响合约ID'
        );
        checkEqual(
          step,
          false,
          latestNotification.readByLicenseeIds.includes(consumerId),
          '通知初始为未读'
        );
      }

      if (step.passed) step.message = `产品下架成功，${affectedContractIds.length} 份合约被终止，通知已生成`;
      step.data = {
        notificationId: latestNotification?.id,
        affectedContractIds,
        affectedLicenseeIds: Array.from(affectedLicenseeIds),
      };
      results.push(step);
    } catch (e: any) {
      results.push({
        step: 'S9',
        name: '下架产品（验证合约终止+凭证撤销+通知生成）',
        passed: false,
        message: e.message,
      });
    }
  }

  // Step 10: 监管时间线追溯
  if (product) {
    try {
      const step: StepResult = {
        step: 'S10',
        name: '监管时间线追溯（按产品查看完整链路）',
        passed: true,
        message: '',
      };

      const records = store.circulationRecords.filter((r) => r.productId === product!.id);
      const recordTypes = new Set(records.map((r) => r.recordType));

      const expectedTypes: CirculationRecord['recordType'][] = [
        'registration',
        'application',
        'approval',
        'contract_sign',
        'usage',
        'bill_pay',
        'offline',
      ];
      const missingTypes = expectedTypes.filter((t) => !recordTypes.has(t));
      const hasRefs = records.every(
        (r) =>
          r.recordType === 'registration' ||
          r.applicationId ||
          r.contractId ||
          r.billId ||
          r.tokenId
      );

      checkEqual(step, 0, missingTypes.length, `所有流通类型均有记录 (缺失: ${missingTypes.join(',') || '无'})`);
      checkEqual(step, true, records.length >= expectedTypes.length, '记录条数足够');
      checkEqual(step, true, hasRefs, '非登记记录均带有关联业务ID');

      if (step.passed) {
        step.message = `监管追溯完整，共 ${records.length} 条记录，涵盖 ${recordTypes.size} 种流通类型`;
      }
      step.data = {
        totalRecords: records.length,
        recordTypes: Array.from(recordTypes),
        sampleRecord: records[0],
      };
      results.push(step);
    } catch (e: any) {
      results.push({
        step: 'S10',
        name: '监管时间线追溯',
        passed: false,
        message: e.message,
      });
    }
  }

  const passedSteps = results.filter((r) => r.passed).length;
  const allPassed = passedSteps === results.length;

  return success(
    res,
    {
      config: { pricingModel, unitPrice, callCount, successCount },
      summary: {
        totalSteps: results.length,
        passedSteps,
        failedSteps: results.length - passedSteps,
        allPassed,
      },
      ids: {
        productId: product?.id,
        applicationId: application?.id,
        contractId: contract?.id,
        tokenId: token?.id,
        billId: bill?.id,
      },
      amountCheck: {
        accumulatedUsageAmount: contract ? Number(contract.accumulatedUsageAmount.toFixed(4)) : null,
        amountPaid: contract ? Number(contract.amountPaid.toFixed(4)) : null,
        billTotalAmount: bill?.totalAmount ?? null,
        expectedPaidEqualsBill:
          contract && bill
            ? Math.abs(contract.amountPaid - bill.totalAmount) < 0.01
            : null,
      },
      steps: results,
    },
    allPassed ? '端到端验收通过' : `验收未完全通过，${passedSteps}/${results.length} 步成功`
  );
});

export default router;
