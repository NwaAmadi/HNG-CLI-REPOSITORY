export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class AuthRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthRequiredError";
  }
}

export const formatCliError = (error: unknown) => {
  if (error instanceof ApiError) {
    return `Error: ${error.message}`;
  }

  if (error instanceof AuthRequiredError) {
    return `Error: ${error.message}`;
  }

  if (error instanceof Error) {
    return `Error: ${error.message}`;
  }

  return "Error: Something went wrong";
};
