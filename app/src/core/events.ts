type Listener = () => void;

const listeners = new Map<string, Set<Listener>>();

/** Subscribes to data changes of a topic (a plugin id, or "plugins"). Returns the unsubscribe. */
export function onChanged(topic: string, listener: Listener): () => void {
  const set = listeners.get(topic) ?? new Set<Listener>();
  set.add(listener);
  listeners.set(topic, set);
  return () => set.delete(listener);
}

export function emitChanged(topic: string): void {
  listeners.get(topic)?.forEach((l) => l());
}
