export type StatusEventLike = {
  toStatus: string;
  createdAt: Date;
};

const MS_PER_DAY = 86_400_000;

export function roundDays(value: number): number {
  return Math.round(value * 10) / 10;
}

export function diffDays(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / MS_PER_DAY;
}

export function getCurrentStatusStartedAt(
  createdAt: Date,
  statusEvents: StatusEventLike[],
): Date {
  if (statusEvents.length === 0) {
    return createdAt;
  }
  return statusEvents[statusEvents.length - 1]!.createdAt;
}

export function getCurrentStatusDays(
  createdAt: Date,
  statusEvents: StatusEventLike[],
  now = new Date(),
): number {
  return roundDays(diffDays(getCurrentStatusStartedAt(createdAt, statusEvents), now));
}
