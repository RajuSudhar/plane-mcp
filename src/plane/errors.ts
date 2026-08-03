export class PlaneApiError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string) {
    super(`Plane API error ${status}: ${body}`);
    this.name = 'PlaneApiError';
    this.status = status;
    this.body = body;
  }
}

export class PlaneRateLimitError extends PlaneApiError {
  readonly resetAt: number;

  constructor(body: string, resetAt: number) {
    super(429, body);
    this.name = 'PlaneRateLimitError';
    this.resetAt = resetAt;
  }
}
