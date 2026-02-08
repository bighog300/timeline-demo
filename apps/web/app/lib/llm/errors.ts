export class NotConfiguredError extends Error {
  code: 'not_configured';

  constructor(message: string) {
    super(message);
    this.name = 'NotConfiguredError';
    this.code = 'not_configured';
  }
}
