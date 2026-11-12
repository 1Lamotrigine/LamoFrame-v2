export function resolve(...parts) {
  const result = [];
  for (const part of parts) {
    if (String(part).startsWith("/")) result.length = 0;
    for (const v of String(part).split("/")) {
      if (v === "..") result.pop();
      else if (v && v !== ".") result.push(v);
    }
  }
  return "/" + result.join("/");
}
export const basename = (value) => String(value).split("/").pop();
export const extname = (value) => {
  const name = basename(value);
  return name.includes(".") ? "." + name.split(".").pop() : "";
};
