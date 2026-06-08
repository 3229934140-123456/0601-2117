import { Router, Request, Response } from 'express';
import { store } from '../store';
import { success, fail, paginate } from '../utils';
import {
  DataProduct,
  ProductRegistrationRequest,
  ProductQueryParams,
  ProductStatus,
  OfflineNotification,
} from '../types';

const router = Router();

router.post('/register', (req: Request, res: Response) => {
  const body = req.body as ProductRegistrationRequest;

  if (!body.name || !body.source || !body.industry || !body.region) {
    return fail(res, '产品名称、来源、行业、地区为必填项');
  }
  if (!body.updateFrequency || !body.availableScope || !body.pricingModel) {
    return fail(res, '更新频率、可用范围、定价方式为必填项');
  }
  if (body.price === undefined || body.price === null || body.price < 0) {
    return fail(res, '价格必须为非负数');
  }

  const now = store.now();
  const product: DataProduct = {
    id: store.generateId(),
    name: body.name,
    description: body.description || '',
    source: body.source,
    industry: body.industry,
    region: body.region,
    tags: body.tags || [],
    updateFrequency: body.updateFrequency,
    availableScope: body.availableScope,
    pricingModel: body.pricingModel,
    price: body.price,
    ownerId: body.ownerId,
    ownerName: body.ownerName || '',
    status: 'active',
    sampleDataAvailable: body.sampleDataAvailable ?? false,
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
    `数据产品「${product.name}」登记成功`,
    { industry: product.industry, region: product.region }
  );

  return success(res, product, '产品登记成功');
});

router.get('/list', (req: Request, res: Response) => {
  const query = req.query as unknown as ProductQueryParams;
  let products = Array.from(store.products.values());

  if (query.keyword) {
    const kw = query.keyword.toLowerCase();
    products = products.filter(
      (p) =>
        p.name.toLowerCase().includes(kw) ||
        p.description.toLowerCase().includes(kw) ||
        p.tags.some((t) => t.toLowerCase().includes(kw))
    );
  }
  if (query.industry) {
    products = products.filter((p) => p.industry === query.industry);
  }
  if (query.region) {
    products = products.filter((p) => p.region === query.region);
  }
  if (query.tags && query.tags.length > 0) {
    const tags = Array.isArray(query.tags) ? query.tags : [query.tags];
    products = products.filter((p) => tags.some((t) => p.tags.includes(t)));
  }
  if (query.status) {
    products = products.filter((p) => p.status === query.status);
  } else {
    products = products.filter((p) => p.status !== 'offline');
  }

  products.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const result = paginate(products, query.page, query.pageSize);
  return success(res, result);
});

router.get('/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const product = store.products.get(id);
  if (!product) {
    return fail(res, '产品不存在', 404);
  }
  return success(res, product);
});

router.put('/:id/status', (req: Request, res: Response) => {
  const { id } = req.params;
  const { status, reason } = req.body as { status: ProductStatus; reason?: string };
  const product = store.products.get(id);

  if (!product) {
    return fail(res, '产品不存在', 404);
  }

  const validStatuses: ProductStatus[] = ['active', 'inactive', 'offline', 'pending_review'];
  if (!validStatuses.includes(status)) {
    return fail(res, '无效的产品状态');
  }

  product.status = status;
  product.updatedAt = store.now();

  if (status === 'offline') {
    product.offlineAt = product.updatedAt;
    product.offlineReason = reason || '产品下架';

    const affectedContractIds: string[] = [];
    const affectedLicenseeIds = new Set<string>();
    store.contracts.forEach((c) => {
      if (c.productId === id && c.status === 'active') {
      c.status = 'terminated';
      affectedContractIds.push(c.id);
      affectedLicenseeIds.add(c.licenseeId);
      }
    });

    store.tokens.forEach((t) => {
      if (t.productId === id && !t.isRevoked) {
        t.isRevoked = true;
      }
    });

    if (affectedContractIds.length > 0) {
      const notification: OfflineNotification = {
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
      };
      store.offlineNotifications.push(notification);
    }

    store.addCirculationRecord(
      'offline',
      product.id,
      product.name,
      product.ownerId,
      product.ownerName,
      'provider',
      `数据产品「${product.name}」已下架，原因：${product.offlineReason}`,
      {
        reason: product.offlineReason,
        affectedContractCount: affectedContractIds.length,
        affectedLicenseeCount: affectedLicenseeIds.size,
      },
      { contractId: affectedContractIds[0] }
    );
  }

  return success(res, product, '产品状态更新成功');
});

router.get('/notifications/mine', (req: Request, res: Response) => {
  const { licenseeId, unreadOnly } = req.query;
  if (!licenseeId) {
    return fail(res, '调用方ID(licenseeId)为必填项');
  }

  let notifications = store.offlineNotifications.filter((n) =>
    n.notifiedLicenseeIds.includes(licenseeId as string)
  );

  if (unreadOnly === 'true') {
    notifications = notifications.filter(
      (n) => !n.readByLicenseeIds.includes(licenseeId as string)
    );
  }

  const enriched = notifications.map((n) => ({
    ...n,
    isRead: n.readByLicenseeIds.includes(licenseeId as string),
    affectedContracts: n.affectedContractIds.map((cid) => {
      const c = store.contracts.get(cid);
      return c
        ? { id: c.id, status: c.status, licenseeName: c.licenseeName, signedAt: c.signedAt, expiresAt: c.expiresAt }
        : { id: cid };
    }),
  }));

  return success(res, {
    licenseeId,
    total: enriched.length,
    unread: enriched.filter((n) => !n.isRead).length,
    notifications: enriched,
  });
});

router.post('/notifications/:notificationId/read', (req: Request, res: Response) => {
  const { notificationId } = req.params;
  const { licenseeId } = req.body as { licenseeId: string };

  if (!licenseeId) {
    return fail(res, '调用方ID(licenseeId)为必填项');
  }

  const notification = store.offlineNotifications.find((n) => n.id === notificationId);
  if (!notification) {
    return fail(res, '通知不存在', 404);
  }
  if (!notification.notifiedLicenseeIds.includes(licenseeId)) {
    return fail(res, '无权标记非本人通知');
  }
  if (!notification.readByLicenseeIds.includes(licenseeId)) {
    notification.readByLicenseeIds.push(licenseeId);
  }

  return success(
    res,
    {
      notificationId,
      isRead: true,
      readByCount: notification.readByLicenseeIds.length,
      notifiedCount: notification.notifiedLicenseeIds.length,
    },
    '已标记为已读'
  );
});

router.get('/:productId/notifications', (req: Request, res: Response) => {
  const { productId } = req.params;
  const product = store.products.get(productId);
  if (!product) {
    return fail(res, '产品不存在', 404);
  }

  const notifications = store.offlineNotifications
    .filter((n) => n.productId === productId)
    .map((n) => ({
      ...n,
      readCount: n.readByLicenseeIds.length,
      unreadCount: n.notifiedLicenseeIds.length - n.readByLicenseeIds.length,
    }));

  return success(res, {
    productId,
    productName: product.name,
    totalNotifications: notifications.length,
    notifications,
  });
});

export default router;
