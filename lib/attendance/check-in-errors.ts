const WRONG_CLASS_ERROR = 'This student is not enrolled in the selected class';

export function toCheckInErrorMessage(message: string) {
  if (message.includes(WRONG_CLASS_ERROR)) {
    return 'This student is not on the selected class roll. Choose the correct class and scan again.';
  }

  return message;
}
