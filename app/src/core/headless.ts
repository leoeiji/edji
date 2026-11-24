import { assistantLog } from '../../modules/edji-assistant';
import { ensureReady, processPendingCommands } from './runtime';

type TaskData = { reason?: string; requestedAt?: number; commandId?: number };

/**
 * Headless JS task `EdjiCommand`. `warmup` boots the runtime and the database
 * while the user is still speaking; `command` runs the pending inbox.
 */
export async function headlessCommandTask(data: TaskData): Promise<void> {
  const startedAt = Date.now();
  const delay = data.requestedAt ? `${Math.round(startedAt - data.requestedAt)} ms após o pedido` : '';
  assistantLog(`js: task ${data.reason ?? '?'} iniciada ${delay}`);
  try {
    await ensureReady();
    if (data.reason === 'warmup') {
      assistantLog(`js: aquecido em ${Date.now() - startedAt} ms`);
      return;
    }
    const n = await processPendingCommands();
    assistantLog(`js: ${n} comando(s) processado(s) em ${Date.now() - startedAt} ms`);
  } catch (e) {
    assistantLog(`js: erro na task: ${e instanceof Error ? e.message : String(e)}`);
  }
}
