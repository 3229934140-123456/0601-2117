import { Response } from 'express';
import { ApiResponse, PaginatedResult } from '../types';

export function success<T>(res: Response, data?: T, message: string = 'success'): void {
  const result: ApiResponse<T> = {
    code: 0,
    message,
    data,
  };
  res.json(result);
}

export function fail(res: Response, message: string, code: number = 400): void {
  const result: ApiResponse = {
    code,
    message,
  };
  res.status(code >= 400 && code < 600 ? code : 400).json(result);
}

export function paginate<T>(
  list: T[],
  page: number = 1,
  pageSize: number = 20
): PaginatedResult<T> {
  const currentPage = Math.max(1, page);
  const size = Math.min(Math.max(1, pageSize), 100);
  const start = (currentPage - 1) * size;
  return {
    data: list.slice(start, start + size),
    total: list.length,
    page: currentPage,
    pageSize: size,
  };
}

export function generateToken(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 64; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export function addDays(dateStr: string, days: number): string {
  const date = new Date(dateStr);
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

export function getBillingPeriod(dateStr: string): string {
  const date = new Date(dateStr);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}
