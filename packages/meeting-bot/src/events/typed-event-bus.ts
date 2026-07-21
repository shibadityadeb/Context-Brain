import { EventEmitter } from 'node:events';

/**
 * A thin, fully-typed wrapper over Node's EventEmitter. Listeners and emits are
 * checked against an event→payload map `M`, so subscribers always receive the
 * exact payload declared for an event. Both the meeting and calendar buses are
 * concrete specializations of this.
 */
export class TypedEventBus<M> {
  private readonly emitter = new EventEmitter();

  constructor() {
    // Many independent subscribers per bus; avoid the 10-listener warning.
    this.emitter.setMaxListeners(0);
  }

  on<K extends keyof M & string>(event: K, listener: (payload: M[K]) => void): this {
    this.emitter.on(event, listener as (payload: unknown) => void);
    return this;
  }

  once<K extends keyof M & string>(event: K, listener: (payload: M[K]) => void): this {
    this.emitter.once(event, listener as (payload: unknown) => void);
    return this;
  }

  off<K extends keyof M & string>(event: K, listener: (payload: M[K]) => void): this {
    this.emitter.off(event, listener as (payload: unknown) => void);
    return this;
  }

  emit<K extends keyof M & string>(event: K, payload: M[K]): boolean {
    return this.emitter.emit(event, payload);
  }

  /** Remove every listener — used on full shutdown. */
  removeAll(): void {
    this.emitter.removeAllListeners();
  }
}
