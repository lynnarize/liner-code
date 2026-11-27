/*
  A project's tile letters, one rule everywhere it is drawn (Home's project chip, the session's top row, the sidebar's
  card), so one project never shows two different pairs. Its own file, with no imports, so the engine's tests read it.
*/

/**
  The first letter of its first two words, else its first two letters, in capitals. Words part at spaces, "_", "-", "."
  and "/", and where a small letter meets a capital ("linerCode" is LC). Letters are counted as characters, so a name
  in another script or with an emoji is never cut in half; an empty name is "?".
*/
export function tileLetters(name: string) {
  const words = name.replace(/(\p{Ll})(\p{Lu})/gu, "$1 $2").split(/[\s_\-./]+/).filter(Boolean);
  const letters = words.length > 1 ? [...words[0]][0] + [...words[1]][0] : [...(words[0] ?? "")].slice(0, 2).join("");
  return (letters || "?").toUpperCase();
}
