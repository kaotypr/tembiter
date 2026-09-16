export class PromptCancelled extends Error {
  constructor(message = "Cancelled") {
    super(message);
    this.name = "PromptCancelled";
  }
}

export class PromptBack extends Error {
  constructor() {
    super("Back");
    this.name = "PromptBack";
  }
}
