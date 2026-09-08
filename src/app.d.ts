declare global {
  namespace App {
    interface Locals {
      authenticated: boolean;
    }
    interface Error {
      message: string;
    }
  }
}

export {};
