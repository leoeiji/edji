import type { Plugin } from '@/core/plugin';
import { FinanceView } from './FinanceView';
import { FINANCE_MIGRATIONS } from './store';
import { financeTools } from './tools';

/**
 * Finance: a local ledger of spending and income (`finance_transactions` in
 * `edji.db`). Routines feed it from bank notifications through `run_tool`
 * with steps written by the agent from the user's examples (ADR 0005); no
 * bank format is built in.
 */
export const financePlugin: Plugin = {
  id: 'finance',
  name: 'Finanças',
  version: '1',
  enabledByDefault: true,
  tools: financeTools(),
  view: { title: 'Finanças', Component: FinanceView },
  migrations: FINANCE_MIGRATIONS,
};
