// Decode locally using the browser, then reuse the existing image size/format limits.
export default function sharp(buffer) {
  let checked;
  async function metadata() {
    if (!checked)
      checked = (async () => {
        const b = new Uint8Array(buffer);
        let format;
        if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47)
          format = "png";
        else if (b[0] === 0xff && b[1] === 0xd8) format = "jpeg";
        else if (String.fromCharCode(...b.slice(0, 3)) === "GIF")
          format = "gif";
        else if (
          String.fromCharCode(...b.slice(0, 4)) === "RIFF" &&
          String.fromCharCode(...b.slice(8, 12)) === "WEBP"
        )
          format = "webp";
        if (!format) throw Error("Это не изображение");
        const image = await createImageBitmap(new Blob([b]));
        const { width, height } = image;
        image.close();
        if (width * height > 40000000)
          throw Error("Слишком большое изображение");
        return { width, height, format };
      })();
    return checked;
  }
  return { metadata, stats: metadata };
}
