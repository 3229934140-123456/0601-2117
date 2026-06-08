import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import productRouter from './routes/product';
import applicationRouter from './routes/application';
import contractRouter from './routes/contract';
import usageRouter from './routes/usage';
import supervisionRouter from './routes/supervision';
import { fail } from './utils';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.use((req: Request, _res: Response, next: NextFunction) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

app.get('/health', (_req: Request, res: Response) => {
  res.json({
    code: 0,
    message: 'ok',
    data: {
      service: 'data-element-circulation-platform',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
    },
  });
});

app.use('/api/product', productRouter);
app.use('/api/application', applicationRouter);
app.use('/api/contract', contractRouter);
app.use('/api/usage', usageRouter);
app.use('/api/supervision', supervisionRouter);

app.use((_req: Request, res: Response) => {
  fail(res, '接口不存在', 404);
});

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Server Error:', err);
  fail(res, err.message || '服务器内部错误', 500);
});

app.listen(PORT, () => {
  console.log(`数据要素流通平台后端服务已启动`);
  console.log(`服务地址: http://localhost:${PORT}`);
  console.log(`健康检查: http://localhost:${PORT}/health`);
  console.log('');
  console.log('API 路由列表:');
  console.log('  /api/product/*       - 数据产品（登记、查询、下架等）');
  console.log('  /api/application/*   - 样例/试用申请与审批');
  console.log('  /api/contract/*      - 合约状态、授权凭证、权限校验');
  console.log('  /api/usage/*         - 用量回传、结算明细、账单');
  console.log('  /api/supervision/*   - 监管流通记录查询');
});

export default app;
