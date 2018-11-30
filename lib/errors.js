class LaunchPackError extends Error {
  constructor(message) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

class RedirectError extends LaunchPackError {
  constructor(message, redirect) {
    super(message);
    this.redirect = redirect;
  }
}

class RenderError extends LaunchPackError {
  constructor(error) {
    super(error.message);
    this.errorDetail = error;
  }
}

module.exports = {
  RedirectError,
  RenderError,
};
