import {
  docPages,
  pageFramesForDevice,
  docComponents,
  isManualResponsive,
} from "./render.js";
/** Geometry checks, not a substitute for visual preview of automatic reflow. */
export function inspectLayouts(doc) {
  const issues = [];
  const devices = isManualResponsive(doc)
    ? ["desktop", "tablet", "phone"]
    : ["desktop"];
  for (const page of docPages(doc))
    for (const device of devices) {
      const shared = docComponents(doc, device);
      const frames = [
        ...pageFramesForDevice(page, device),
        shared.header,
        shared.footer,
      ].filter((f) => f && !f.hidden);
      for (const frame of frames) {
        const report = (element, message) =>
          issues.push({
            pageId: page.id,
            page: page.name,
            device,
            frameId: frame.id,
            elementId: element?.id,
            message,
          });
        for (const el of frame.elements || []) {
          if (el.hidden) continue;
          const x = Number(el.x) || 0,
            y = Number(el.y) || 0,
            w = Number(el.w) || 0,
            h = Number(el.h) || 0;
          const radians = ((Number(el.rotation) || 0) * Math.PI) / 180;
          const bw =
            Math.abs(w * Math.cos(radians)) + Math.abs(h * Math.sin(radians));
          const bh =
            Math.abs(w * Math.sin(radians)) + Math.abs(h * Math.cos(radians));
          if (
            x + w / 2 - bw / 2 < -1 ||
            y + h / 2 - bh / 2 < -1 ||
            x + w / 2 + bw / 2 > Number(frame.w) + 1 ||
            y + h / 2 + bh / 2 > Number(frame.h) + 1
          )
            report(
              el,
              `«${el.name || el.type}» выходит за границы секции «${frame.name || "Фрейм"}».`,
            );
          if (el.type === "image" && !el.props?.src)
            report(
              el,
              `У изображения «${el.name || "Изображение"}» не выбран файл.`,
            );
          if (
            ["button", "link"].includes(el.type) &&
            !String(el.props?.href || "").trim()
          )
            report(el, `У ссылки «${el.name || el.type}» не указан адрес.`);
        }
      }
    }
  return issues;
}
