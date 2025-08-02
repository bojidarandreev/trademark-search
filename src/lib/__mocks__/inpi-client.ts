export const getAccessToken = jest.fn().mockResolvedValue("test_token");
export const logError = jest.fn();
export const client = {
  defaults: {
    jar: {},
  },
};
export class APIError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "APIError";
  }
}
