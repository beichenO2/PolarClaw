/**
 * Parse user materials into a normalized structure for site generation.
 * @param {string | object} input Raw text, markdown, or structured object / JSON string
 * @param {'text' | 'markdown' | 'json' | 'auto'} format Input format; auto tries JSON then markdown heuristics
 * @returns {{ title: string, sections: Array<{ heading: string, content: string, keyPoints: string[] }> }}
 */
export function parseContent(input, format = 'auto') {
  if (input == null) {
    return { title: 'Untitled', sections: [] };
  }

  let resolved = format;
  if (resolved === 'auto') {
    resolved = detectFormat(input);
  }

  if (resolved === 'json') {
    return parseStructured(input);
  }
  if (resolved === 'markdown') {
    return parseMarkdown(typeof input === 'string' ? input : String(input));
  }
  return parsePlainText(typeof input === 'string' ? input : String(input));
}

function detectFormat(input) {
  const s = typeof input === 'string' ? input.trim() : '';
  if (typeof input === 'object' && input !== null && !Array.isArray(input)) {
    return 'json';
  }
  if (s.startsWith('{') || s.startsWith('[')) {
    try {
      const v = JSON.parse(s);
      if (v && typeof v === 'object' && (Array.isArray(v.sections) || v.title)) {
        return 'json';
      }
    } catch {
      /* fall through */
    }
  }
  if (/^#\s/m.test(s) || /^##\s/m.test(s)) {
    return 'markdown';
  }
  return 'text';
}

function parseStructured(input) {
  let obj = input;
  if (typeof input === 'string') {
    obj = JSON.parse(input);
  }
  const title =
    typeof obj.title === 'string' && obj.title.trim()
      ? obj.title.trim()
      : 'Learning module';
  const rawSections = Array.isArray(obj.sections) ? obj.sections : [];
  const sections = rawSections.map((s, i) => normalizeSection(s, i));
  if (sections.length === 0 && typeof obj.content === 'string' && obj.content.trim()) {
    sections.push({
      heading: 'Overview',
      content: obj.content.trim(),
      keyPoints: extractBulletsFromBlock(obj.content),
    });
  }
  return { title, sections };
}

function normalizeSection(s, index) {
  const heading =
    typeof s.heading === 'string' && s.heading.trim()
      ? s.heading.trim()
      : `Section ${index + 1}`;
  const content =
    typeof s.content === 'string' ? s.content.trim() : '';
  let keyPoints = Array.isArray(s.keyPoints)
    ? s.keyPoints.map((k) => String(k).trim()).filter(Boolean)
    : [];
  if (keyPoints.length === 0) {
    keyPoints = extractBulletsFromBlock(content);
  }
  if (keyPoints.length === 0 && content) {
    keyPoints = sentencesAsKeyPoints(content);
  }
  return { heading, content, keyPoints };
}

function extractBulletsFromBlock(block) {
  const lines = block.split(/\r?\n/);
  const points = [];
  for (const line of lines) {
    const m = line.match(/^\s*[-*•]\s+(.+)/);
    if (m) points.push(m[1].trim());
  }
  return points;
}

function sentencesAsKeyPoints(text, max = 5) {
  const parts = text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 12);
  return parts.slice(0, max);
}

function parseMarkdown(md) {
  const lines = md.split(/\r?\n/);
  let title = 'Learning module';
  const sections = [];
  let current = null;

  const flush = () => {
    if (current) {
      sections.push(finalizeSection(current));
      current = null;
    }
  };

  for (const line of lines) {
    const h1 = line.match(/^#\s+(.+)/);
    if (h1) {
      flush();
      title = h1[1].trim();
      continue;
    }
    const h2 = line.match(/^##\s+(.+)/);
    if (h2) {
      flush();
      current = { heading: h2[1].trim(), bodyLines: [] };
      continue;
    }
    if (current) {
      current.bodyLines.push(line);
    } else {
      if (!sections.length && line.trim()) {
        if (!current) {
          current = { heading: 'Introduction', bodyLines: [] };
        }
        current.bodyLines.push(line);
      }
    }
  }
  flush();

  if (sections.length === 0) {
    const content = lines.join('\n').replace(/^#\s+[^\n]+\n?/, '').trim();
    return {
      title,
      sections: content
        ? [
            {
              heading: 'Content',
              content,
              keyPoints: extractBulletsFromBlock(content).length
                ? extractBulletsFromBlock(content)
                : sentencesAsKeyPoints(content),
            },
          ]
        : [],
    };
  }

  return { title, sections };
}

function finalizeSection(current) {
  const body = current.bodyLines.join('\n').trim();
  let keyPoints = extractBulletsFromBlock(body);
  if (keyPoints.length === 0) {
    keyPoints = sentencesAsKeyPoints(body);
  }
  const content = body.replace(/^\s*[-*•]\s+.+\n?/gm, '').trim() || body;
  return {
    heading: current.heading,
    content: content || body,
    keyPoints,
  };
}

function parsePlainText(text) {
  const blocks = text.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  if (blocks.length === 0) {
    return { title: 'Untitled', sections: [] };
  }

  const titleCandidate = blocks[0];
  const looksLikeTitle =
    titleCandidate.length < 80 && !titleCandidate.includes('\n');

  let title = 'Learning module';
  let startIdx = 0;
  if (looksLikeTitle) {
    title = titleCandidate.replace(/^title:\s*/i, '').trim();
    startIdx = 1;
  }

  const sections = [];
  for (let i = startIdx; i < blocks.length; i++) {
    const block = blocks[i];
    const lines = block.split(/\r?\n/);
    const first = lines[0];
    const sectionHeader =
      /^(section\s*\d+[:.]?\s*|part\s*\d+[:.]?\s*|^\d+\.\s+)(.+)$/i.exec(first) ||
      (/^[A-Z][^.!?]{2,60}$/.test(first.trim()) && lines.length > 1
        ? { 2: first.trim() }
        : null);

    let heading;
    let contentLines;
    if (sectionHeader && sectionHeader[2]) {
      heading = sectionHeader[2].trim();
      contentLines = lines.slice(1);
    } else {
      heading = `Topic ${sections.length + 1}`;
      contentLines = lines;
    }

    const content = contentLines.join('\n').trim();
    let keyPoints = extractBulletsFromBlock(content);
    if (keyPoints.length === 0) {
      keyPoints = sentencesAsKeyPoints(content);
    }
    sections.push({ heading, content, keyPoints });
  }

  if (sections.length === 0 && blocks.length) {
    const content = blocks.slice(startIdx).join('\n\n');
    sections.push({
      heading: 'Overview',
      content,
      keyPoints:
        extractBulletsFromBlock(content).length > 0
          ? extractBulletsFromBlock(content)
          : sentencesAsKeyPoints(content),
    });
  }

  return { title, sections };
}
