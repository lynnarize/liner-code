/*
  A JSON.parse fault in words a person can act on: what is wrong and the line and column it is at, without the
  character offset or the text echoed back. Cutting the message at a word count or a comma left half a phrase
  ("Expected ':' after property name in", or "Expected '" from "Expected ',' or '}'"). Pure, so a node test can pin it.
*/
export const jsonFault = (message: string) => {
  const where = /\(line (\d+) column (\d+)\)/.exec(message);
  const what = message.replace(/, ".*$/s, "").replace(/ (in JSON )?at position \d+.*$/s, "");
  return where ? `${what} (line ${where[1]}, column ${where[2]})` : what;
};
