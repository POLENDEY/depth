export type QuoteRow = { label: string; detail?: string; value: string; leftOut?: boolean; emphasized?: boolean };
export type QuoteSection = { step: string; title: string; note: string; rows: QuoteRow[] };

export type Quote = {
  title: string;
  subtitle: string;
  date: string;
  picture: HTMLCanvasElement | null;
  facts: [string, string][];
  summary: [string, string][];
  sections: QuoteSection[];
  total: [string, string];
  notes: string[];
};

const WIDTH = 1200;
const PAD = 56;
const INNER = WIDTH - PAD * 2;
const SCALE = 2;
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
const PICTURE_HEIGHT = 420;

export const QUOTE_PICTURE = { width: INNER, height: PICTURE_HEIGHT };

// The whole quotation as a PNG, white, `WIDTH` CSS pixels wide at twice the resolution.
export function quoteImage(quote: Quote) {
  const draft = document.createElement("canvas");
  draft.width = WIDTH * SCALE;
  draft.height = 8000 * SCALE;
  const context = draft.getContext("2d");
  if (!context) throw new Error("Could not draw the quotation.");
  context.scale(SCALE, SCALE);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, WIDTH, 8000);
  const height = Math.ceil(drawQuote(context, quote));

  const canvas = document.createElement("canvas");
  canvas.width = WIDTH * SCALE;
  canvas.height = height * SCALE;
  canvas.getContext("2d")?.drawImage(draft, 0, 0);
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not save the quotation image."))), "image/png"),
  );
}

export type PriceCard = {
  picture: HTMLCanvasElement | null;
  price: string;
  perPiece: string | null;
  name: string;
  size: string;
  facts: [string, string][];
};

const CARD_PAD = 24;
const CARD_INNER = WIDTH - CARD_PAD * 2;
const CARD_PICTURE_HEIGHT = 480;

export const CARD_PICTURE = { width: CARD_INNER, height: CARD_PICTURE_HEIGHT };

// The 3D view with its price and the job details, dark like the dialog, as a PNG.
export function priceCardImage(card: PriceCard) {
  const columns = 2;
  const factHeight = 92;
  const rows = Math.ceil(card.facts.length / columns);
  const height = CARD_PAD + CARD_PICTURE_HEIGHT + 16 + rows * factHeight + (rows - 1) * 12 + CARD_PAD;
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH * SCALE;
  canvas.height = height * SCALE;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not draw the image.");
  context.scale(SCALE, SCALE);
  box(context, 0, 0, WIDTH, height, "#1e1e24");

  let y = CARD_PAD;
  const gradient = context.createLinearGradient(0, y, 0, y + CARD_PICTURE_HEIGHT);
  gradient.addColorStop(0, "#2a2a33");
  gradient.addColorStop(1, "#18181d");
  box(context, CARD_PAD, y, CARD_INNER, CARD_PICTURE_HEIGHT, gradient);
  if (card.picture) context.drawImage(card.picture, CARD_PAD, y, CARD_INNER, CARD_PICTURE_HEIGHT);

  const left = CARD_PAD + 28;
  const right = WIDTH - CARD_PAD - 28;
  context.textAlign = "left";
  font(context, 17, 500);
  context.fillStyle = "#a1a1aa";
  context.fillText("CUSTOMER PAYS", left, y + 44);
  font(context, 48, 700);
  context.fillStyle = "#34d399";
  context.fillText(card.price, left, y + 98);
  if (card.perPiece) {
    font(context, 18);
    context.fillStyle = "#d4d4d8";
    context.fillText(card.perPiece, left, y + 128);
  }
  context.textAlign = "right";
  font(context, 22, 700);
  context.fillStyle = "#f4f4f5";
  context.fillText(card.name, right, y + 44, CARD_INNER / 2);
  font(context, 18);
  context.fillStyle = "#a1a1aa";
  context.fillText(card.size, right, y + 72);
  context.textAlign = "left";
  y += CARD_PICTURE_HEIGHT + 16;

  const width = (CARD_INNER - (columns - 1) * 12) / columns;
  card.facts.forEach(([label, value], index) => {
    const x = CARD_PAD + (index % columns) * (width + 12);
    const top = y + Math.floor(index / columns) * (factHeight + 12);
    box(context, x, top, width, factHeight, "#2a2a31");
    font(context, 16, 500);
    context.fillStyle = "#a1a1aa";
    context.fillText(label.toUpperCase(), x + 22, top + 36);
    font(context, 24, 600);
    context.fillStyle = "#ffffff";
    context.fillText(value, x + 22, top + 70, width - 44);
  });

  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not save the image."))), "image/png"),
  );
}

function font(context: CanvasRenderingContext2D, size: number, weight = 400) {
  context.font = `${weight} ${size}px ${FONT}`;
}

function wrap(context: CanvasRenderingContext2D, text: string, width: number) {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (line && context.measureText(next).width > width) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

function box(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, fill: string | CanvasGradient) {
  context.fillStyle = fill;
  context.beginPath();
  context.roundRect(x, y, width, height, 14);
  context.fill();
}

// Draws the quotation top to bottom and returns its height.
function drawQuote(context: CanvasRenderingContext2D, quote: Quote) {
  let y = PAD;
  context.textBaseline = "alphabetic";

  font(context, 34, 700);
  context.fillStyle = "#18181b";
  context.textAlign = "left";
  context.fillText(quote.title, PAD, y + 30);
  font(context, 16);
  context.fillStyle = "#71717a";
  context.textAlign = "right";
  context.fillText(quote.date, WIDTH - PAD, y + 28);
  context.textAlign = "left";
  font(context, 18);
  context.fillText(quote.subtitle, PAD, y + 62);
  y += 92;

  if (quote.picture) {
    const gradient = context.createLinearGradient(0, y, 0, y + PICTURE_HEIGHT);
    gradient.addColorStop(0, "#2a2a33");
    gradient.addColorStop(1, "#18181d");
    box(context, PAD, y, INNER, PICTURE_HEIGHT, gradient);
    context.drawImage(quote.picture, PAD, y, INNER, PICTURE_HEIGHT);
    y += PICTURE_HEIGHT + 24;
  }

  const factWidth = (INNER - (quote.facts.length - 1) * 12) / quote.facts.length;
  quote.facts.forEach(([label, value], index) => {
    const x = PAD + index * (factWidth + 12);
    box(context, x, y, factWidth, 72, "#f4f4f5");
    font(context, 13, 600);
    context.fillStyle = "#71717a";
    context.fillText(label.toUpperCase(), x + 16, y + 28);
    font(context, 18, 600);
    context.fillStyle = "#18181b";
    context.fillText(value, x + 16, y + 56, factWidth - 32);
  });
  y += 72 + 16;

  const summaryWidth = (INNER - (quote.summary.length - 1) * 12) / quote.summary.length;
  quote.summary.forEach(([label, value], index) => {
    const x = PAD + index * (summaryWidth + 12);
    const last = index === quote.summary.length - 1;
    box(context, x, y, summaryWidth, 96, last ? "#1e1e24" : "#f4f4f5");
    context.textAlign = "center";
    font(context, 13, 600);
    context.fillStyle = last ? "#a1a1aa" : "#71717a";
    context.fillText(label.toUpperCase(), x + summaryWidth / 2, y + 34);
    font(context, 30, 700);
    context.fillStyle = last ? "#34d399" : "#18181b";
    context.fillText(value, x + summaryWidth / 2, y + 74);
    context.textAlign = "left";
  });
  y += 96 + 28;

  for (const section of quote.sections) {
    context.fillStyle = "#18181b";
    context.beginPath();
    context.arc(PAD + 14, y + 14, 14, 0, Math.PI * 2);
    context.fill();
    font(context, 15, 700);
    context.fillStyle = "#ffffff";
    context.textAlign = "center";
    context.fillText(section.step, PAD + 14, y + 19);
    context.textAlign = "left";
    font(context, 18, 700);
    context.fillStyle = "#18181b";
    context.fillText(section.title.toUpperCase(), PAD + 40, y + 20);
    const titleWidth = context.measureText(section.title.toUpperCase()).width;
    font(context, 15);
    context.fillStyle = "#71717a";
    context.fillText(section.note, PAD + 40 + titleWidth + 12, y + 20);
    y += 42;

    for (const row of section.rows) {
      if (row.emphasized) {
        context.strokeStyle = "#d4d4d8";
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(PAD, y);
        context.lineTo(WIDTH - PAD, y);
        context.stroke();
        y += 12;
      }
      font(context, 18, row.emphasized ? 700 : 600);
      context.fillStyle = row.leftOut ? "#a1a1aa" : "#18181b";
      context.fillText(row.label, PAD, y + 20);
      context.textAlign = "right";
      context.fillText(row.leftOut ? "—" : row.value, WIDTH - PAD, y + 20);
      context.textAlign = "left";
      y += 28;
      const detail = row.leftOut ? "Left out of the price" : row.detail;
      if (detail) {
        font(context, 15);
        context.fillStyle = "#71717a";
        for (const line of wrap(context, detail, INNER - 180)) {
          context.fillText(line, PAD, y + 16);
          y += 22;
        }
      }
      y += 12;
    }
    y += 14;
  }

  box(context, PAD, y, INNER, 76, "#1e1e24");
  font(context, 20, 700);
  context.fillStyle = "#ffffff";
  context.fillText(quote.total[0], PAD + 24, y + 46);
  font(context, 32, 700);
  context.fillStyle = "#34d399";
  context.textAlign = "right";
  context.fillText(quote.total[1], WIDTH - PAD - 24, y + 50);
  context.textAlign = "left";
  y += 76 + 20;

  font(context, 14);
  context.fillStyle = "#71717a";
  for (const note of quote.notes) {
    for (const line of wrap(context, note, INNER)) {
      context.fillText(line, PAD, y + 14);
      y += 21;
    }
  }
  return y + PAD;
}
