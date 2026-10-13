let counter = 0;

/** Identificador local, único o bastante dentro de um aparelho. */
export function newId(prefix = ''): string {
  counter = (counter + 1) % 1_679_616;
  const time = Date.now().toString(36);
  const rand = Math.floor(Math.random() * 2_176_782_336).toString(36);
  return `${prefix}${time}${rand}${counter.toString(36)}`;
}
