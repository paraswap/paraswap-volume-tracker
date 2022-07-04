export class ApplicationError extends Error {
  // eslint-disable-next-line no-useless-constructor
  constructor(message: string, public isLogged: boolean = false) {
    super(message);
  }
}
