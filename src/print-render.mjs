export async function paintPrintSheet(
  context,
  sheet,
  getImage,
  { border = false, grayscale = false } = {},
) {
  context.save();
  context.fillStyle = "#fff";
  context.fillRect(0, 0, sheet.width, sheet.height);
  try {
    for (const slot of sheet.slots) {
      if (slot.number == null) continue;
      const image = await getImage(slot);
      context.save();
      try {
        context.beginPath();
        context.rect(
          slot.cell.x,
          slot.cell.y,
          slot.cell.width,
          slot.cell.height,
        );
        context.clip();
        if (grayscale) context.filter = "grayscale(1)";
        if (slot.rotation === 90) {
          context.translate(slot.rect.x + slot.rect.width, slot.rect.y);
          context.rotate(Math.PI / 2);
          context.drawImage(image, 0, 0, slot.rect.height, slot.rect.width);
        } else
          context.drawImage(
            image,
            slot.rect.x,
            slot.rect.y,
            slot.rect.width,
            slot.rect.height,
          );
      } finally {
        context.restore();
      }
      if (border) {
        context.save();
        context.beginPath();
        context.rect(
          slot.cell.x,
          slot.cell.y,
          slot.cell.width,
          slot.cell.height,
        );
        context.clip();
        context.lineWidth = 0.5;
        context.strokeStyle = "#333";
        context.strokeRect(
          slot.rect.x,
          slot.rect.y,
          slot.rect.width,
          slot.rect.height,
        );
        context.restore();
      }
    }
  } finally {
    context.restore();
  }
}
