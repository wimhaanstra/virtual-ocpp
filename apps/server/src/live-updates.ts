export type LiveRefreshTopic =
  | 'charger'
  | 'sessions'
  | 'charging-stats'
  | 'logs'
  | 'communication'
  | 'proxy-targets'
  | 'proxy-health'
  | 'tags';

export type LiveUpdateEvent =
  | {
      type: 'charger.connected';
      chargerId: string;
      connectionId: string;
      connectedAt: string;
    }
  | {
      type: 'charger.disconnected';
      chargerId: string;
      connectionId: string | null;
      disconnectedAt: string;
    }
  | {
      type: 'charger.updated';
      chargerId: string;
      updatedAt: string;
      reason: string;
    }
  | {
      type: 'session.created';
      chargerId: string;
      sessionId: string;
      transactionId: number;
      connectorId: number;
      startedAt: string;
    }
  | {
      type: 'session.stopped';
      chargerId: string;
      sessionId: string;
      transactionId: number;
      connectorId: number;
      stoppedAt: string;
      reason: string | null | undefined;
    }
  | {
      type: 'meter.sample.recorded';
      chargerId: string;
      connectorId: number;
      transactionId: number | null | undefined;
      sampledAt: string;
      measurand: string | null | undefined;
    }
  | {
      type: 'proxy.health.changed';
      chargerId: string;
      proxyTargetId: string;
      reason: string;
    }
  | {
      type: 'log.recorded';
      logId: string;
      level: 'debug' | 'info' | 'warn' | 'error';
      category: string;
      chargerId: string | null | undefined;
      transactionId: number | null | undefined;
    }
  | {
      type: 'journal.recorded';
      journalId: string;
      chargerId: string | null | undefined;
      proxyTargetId: string | null | undefined;
      messageType: string;
      ocppMethod: string | null | undefined;
    }
  | {
      type: 'journal.purged';
      retentionHours: number;
      deletedCount: number;
    }
  | {
      type: 'refresh';
      topic: LiveRefreshTopic;
      chargerId: string | null;
    };

export type LiveUpdateEnvelope<TEvent extends LiveUpdateEvent = LiveUpdateEvent> = {
  id: string;
  occurredAt: string;
  event: TEvent;
};

type LiveUpdateListener = (event: LiveUpdateEnvelope) => void;

export class LiveUpdateBus {
  private readonly listeners = new Set<LiveUpdateListener>();
  private readonly history: LiveUpdateEnvelope[] = [];
  private nextId = 1;

  constructor(private readonly historyLimit = 200) {}

  publish<TEvent extends LiveUpdateEvent>(event: TEvent): LiveUpdateEnvelope<TEvent>;
  publish(event: LiveRefreshTopic, chargerId?: string | null): LiveUpdateEnvelope;
  publish<TEvent extends LiveUpdateEvent>(eventOrTopic: TEvent | LiveRefreshTopic, chargerId?: string | null) {
    const event =
      typeof eventOrTopic === 'string'
        ? ({
            type: 'refresh',
            topic: eventOrTopic,
            chargerId: chargerId ?? null
          } as LiveUpdateEvent)
        : eventOrTopic;
    const envelope: LiveUpdateEnvelope<TEvent> = {
      id: String(this.nextId++),
      occurredAt: new Date().toISOString(),
      event: event as TEvent
    };

    this.history.push(envelope);
    while (this.history.length > this.historyLimit) {
      this.history.shift();
    }

    for (const listener of this.listeners) {
      listener(envelope);
    }

    return envelope;
  }

  subscribe(listener: LiveUpdateListener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  replaySince(lastEventId?: string | null) {
    if (!lastEventId) {
      return [...this.history];
    }

    const index = this.history.findIndex((event) => event.id === lastEventId);
    if (index === -1) {
      return [...this.history];
    }

    return this.history.slice(index + 1);
  }
}

export function formatSseEvent(envelope: LiveUpdateEnvelope) {
  return `id: ${envelope.id}\nevent: live-update\ndata: ${JSON.stringify(envelope)}\n\n`;
}
