import { Router, Request, Response } from 'express';
import { store } from '../store';
import { success, paginate } from '../utils';
import { CirculationQueryParams, CirculationRecord } from '../types';

const router = Router();

router.get('/records', (req: Request, res: Response) => {
  const query = req.query as unknown as CirculationQueryParams;
  let records = [...store.circulationRecords];

  if (query.recordType) {
    records = records.filter((r) => r.recordType === query.recordType);
  }
  if (query.productId) {
    records = records.filter((r) => r.productId === query.productId);
  }
  if (query.partyId) {
    records = records.filter((r) => r.partyId === query.partyId);
  }
  if (query.startTime) {
    const start = new Date(query.startTime);
    records = records.filter((r) => new Date(r.timestamp) >= start);
  }
  if (query.endTime) {
    const end = new Date(query.endTime);
    records = records.filter((r) => new Date(r.timestamp) <= end);
  }

  const result = paginate(records, query.page, query.pageSize);
  return success(res, result);
});

router.get('/statistics', (req: Request, res: Response) => {
  const { startTime, endTime } = req.query;
  let records = [...store.circulationRecords];

  if (startTime) {
    const start = new Date(startTime as string);
    records = records.filter((r) => new Date(r.timestamp) >= start);
  }
  if (endTime) {
    const end = new Date(endTime as string);
    records = records.filter((r) => new Date(r.timestamp) <= end);
  }

  const byType: Record<string, number> = {};
  const byRole: Record<string, number> = {};
  const byDate: Record<string, number> = {};
  const productRanking: Record<string, { name: string; count: number }> = {};

  records.forEach((r) => {
    byType[r.recordType] = (byType[r.recordType] || 0) + 1;
    byRole[r.partyRole] = (byRole[r.partyRole] || 0) + 1;

    const date = r.timestamp.split('T')[0];
    byDate[date] = (byDate[date] || 0) + 1;

    if (!productRanking[r.productId]) {
      productRanking[r.productId] = { name: r.productName, count: 0 };
    }
    productRanking[r.productId].count += 1;
  });

  const topProducts = Object.entries(productRanking)
    .map(([id, v]) => ({ productId: id, productName: v.name, count: v.count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const activeProducts = Array.from(store.products.values()).filter(
    (p) => p.status === 'active'
  ).length;
  const activeContracts = Array.from(store.contracts.values()).filter(
    (c) => c.status === 'active'
  ).length;
  const totalUsage = store.usageRecords.length;
  const totalBillAmount = Array.from(store.bills.values()).reduce(
    (sum, b) => sum + b.totalAmount,
    0
  );

  return success(res, {
    totalRecords: records.length,
    byType,
    byRole,
    byDate,
    topProducts,
    summary: {
      activeProducts,
      activeContracts,
      totalUsage,
      totalBillAmount,
    },
  });
});

router.get('/product/:productId/timeline', (req: Request, res: Response) => {
  const { productId } = req.params;
  const records = store.circulationRecords
    .filter((r) => r.productId === productId)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  const product = store.products.get(productId);
  const contracts = Array.from(store.contracts.values()).filter((c) => c.productId === productId);
  const applications = Array.from(store.applications.values()).filter(
    (a) => a.productId === productId
  );

  return success(res, {
    product,
    timeline: records,
    contractCount: contracts.length,
    applicationCount: applications.length,
    totalCalls: store.usageRecords.filter((r) => r.productId === productId).length,
  });
});

export default router;
