// Minimal, dependency-free PDF writer for statement exports. It supports the
// single subset we need: A4 pages, Helvetica regular/bold, text, rules and
// filled rectangles. Everything is emitted as uncompressed content streams so
// the output stays auditable without a third-party PDF library.

const PAGE = Object.freeze({ width: 595.28, height: 841.89, margin: 48 });

const FONTS = Object.freeze({ regular: "F1", bold: "F2" });

const escapeText = (value) =>
  String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/[^\x20-\x7E]/g, "?");

const decimal = (value) => Number(value).toFixed(2);

// Helvetica widths are close enough to 0.52/0.56 em for layout and truncation.
const approximateWidth = (text, size, bold) =>
  String(text ?? "").length * size * (bold ? 0.56 : 0.52);

const truncate = (text, maxWidth, size, bold = false) => {
  const source = String(text ?? "");
  if (approximateWidth(source, size, bold) <= maxWidth) return source;
  let output = source;
  while (output.length > 1 && approximateWidth(`${output}...`, size, bold) > maxWidth) {
    output = output.slice(0, -1);
  }
  return `${output}...`;
};

class PdfDocument {
  constructor({ title = "Document", author = "Meridian Bank" } = {}) {
    this.title = title;
    this.author = author;
    this.pages = [];
    this.y = 0;
    this.newPage();
  }

  get width() {
    return PAGE.width - PAGE.margin * 2;
  }

  get left() {
    return PAGE.margin;
  }

  get bottom() {
    return PAGE.margin;
  }

  get currentPage() {
    return this.pages[this.pages.length - 1];
  }

  newPage() {
    this.pages.push([]);
    this.y = PAGE.height - PAGE.margin;
  }

  hasSpace(height) {
    return this.y - height >= this.bottom;
  }

  text(value, options = {}) {
    const {
      x = this.left,
      y = this.y,
      size = 10,
      bold = false,
      color = [0, 0, 0],
      align = "left",
      maxWidth = this.width,
    } = options;
    const content = truncate(value, maxWidth, size, bold);
    const offset = align === "right" ? maxWidth - approximateWidth(content, size, bold) : 0;
    const escaped = escapeText(content);
    this.currentPage.push(
      `BT /${bold ? FONTS.bold : FONTS.regular} ${size} Tf ` +
        `${decimal(color[0])} ${decimal(color[1])} ${decimal(color[2])} rg ` +
        `1 0 0 1 ${decimal(x + offset)} ${decimal(y)} Tm (${escaped}) Tj ET`
    );
    return this;
  }

  textLine(value, options = {}) {
    const { size = 10, bold = false, gap = 16, ...rest } = options;
    this.text(value, { ...rest, y: this.y, size, bold });
    this.y -= gap;
    return this;
  }

  rule(options = {}) {
    const {
      x = this.left,
      width = this.width,
      y = this.y,
      thickness = 0.6,
      color = [0.82, 0.85, 0.89],
    } = options;
    this.currentPage.push(
      `${decimal(color[0])} ${decimal(color[1])} ${decimal(color[2])} RG ` +
        `${decimal(thickness)} w ${decimal(x)} ${decimal(y)} m ` +
        `${decimal(x + width)} ${decimal(y)} l S`
    );
    return this;
  }

  rect(options = {}) {
    const {
      x = this.left,
      y = this.y,
      width = this.width,
      height = 20,
      color = [0.95, 0.97, 1],
    } = options;
    this.currentPage.push(
      `${decimal(color[0])} ${decimal(color[1])} ${decimal(color[2])} rg ` +
        `${decimal(x)} ${decimal(y)} ${decimal(width)} ${decimal(height)} re f`
    );
    return this;
  }

  moveDown(value = 12) {
    this.y -= value;
    return this;
  }

  stampFooter(buildText) {
    const total = this.pages.length;
    this.pages = this.pages.map((ops, index) => {
      const content = escapeText(buildText(index + 1, total));
      return [
        ...ops,
        `BT /${FONTS.regular} 8 Tf 0.45 0.49 0.55 rg ` +
          `1 0 0 1 ${decimal(this.left)} ${decimal(PAGE.margin - 18)} Tm (${content}) Tj ET`,
      ];
    });
    return this;
  }

  build() {
    const objects = [];
    const add = (body) => {
      objects.push(body);
      return objects.length;
    };

    // Reserve fixed object numbers so page content can reference fonts.
    add("<< /Type /Catalog /Pages 2 0 R >>"); // 1
    add("__PAGES_PLACEHOLDER__"); // 2
    const regularFont = add(
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"
    ); // 3
    const boldFont = add(
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"
    ); // 4

    const pageObjectNumbers = [];
    for (const ops of this.pages) {
      const stream = `${ops.join("\n")}\n`;
      const contentNumber = add(
        `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}endstream`
      );
      const pageNumber = add(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] ` +
          `/Resources << /Font << /F1 ${regularFont} 0 R /F2 ${boldFont} 0 R >> >> ` +
          `/Contents ${contentNumber} 0 R >>`
      );
      pageObjectNumbers.push(pageNumber);
    }

    objects[1] = `<< /Type /Pages /Kids [${pageObjectNumbers
      .map((number) => `${number} 0 R`)
      .join(" ")}] /Count ${pageObjectNumbers.length} >>`;

    objects.push(
      `<< /Title (${escapeText(this.title)}) /Author (${escapeText(this.author)}) /Producer (Meridian Bank) /CreationDate (D:${new Date()
        .toISOString()
        .replace(/[-:T]/g, "")
        .slice(0, 14)}Z) >>`
    );
    const infoNumber = objects.length;

    let pdf = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
    const offsets = [0];
    for (let index = 0; index < objects.length; index += 1) {
      offsets.push(Buffer.byteLength(pdf, "latin1"));
      pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
    }

    const xrefOffset = Buffer.byteLength(pdf, "latin1");
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (let index = 1; index <= objects.length; index += 1) {
      pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
    }
    pdf +=
      `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${infoNumber} 0 R >>\n` +
      `startxref\n${xrefOffset}\n%%EOF\n`;

    return Buffer.from(pdf, "latin1");
  }
}

module.exports = { PdfDocument, PAGE };
