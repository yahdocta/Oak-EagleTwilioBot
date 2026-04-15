const NUMBER_WORD_TO_DIGIT = {
  zero: "0",
  oh: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9"
};

function tokenizeTranscript(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9+ ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function toDigitsFromWords(text) {
  const tokens = tokenizeTranscript(text);
  const digits = [];
  for (const token of tokens) {
    if (NUMBER_WORD_TO_DIGIT[token]) {
      digits.push(NUMBER_WORD_TO_DIGIT[token]);
      continue;
    }
    if (/^\d+$/.test(token)) {
      digits.push(token);
    }
  }
  return digits.join("");
}

function tokenToDigit(token) {
  if (NUMBER_WORD_TO_DIGIT[token]) {
    return NUMBER_WORD_TO_DIGIT[token];
  }
  if (/^\d+$/.test(token)) {
    return token;
  }
  return null;
}

function buildTokenRunCandidates(text) {
  const tokens = tokenizeTranscript(text);
  const candidates = [];
  let current = "";

  for (const token of tokens) {
    const digit = tokenToDigit(token);
    if (digit !== null) {
      current += digit;
      continue;
    }

    if (current) {
      candidates.push(current);
      current = "";
    }
  }

  if (current) {
    candidates.push(current);
  }

  return candidates;
}

function buildPhoneCandidates(text) {
  const source = String(text || "");
  const phoneLikeMatches =
    source.match(/(?:\+?1[\s().-]*)?(?:\(?\d{3}\)?[\s.-]*)\d{3}[\s.-]*\d{4}/g) || [];
  const phoneLikeCandidates = phoneLikeMatches.map((match) => match.replace(/\D/g, ""));
  const tokenRunCandidates = buildTokenRunCandidates(source);
  const allDigitsCandidate = source.replace(/[^\d]/g, "");
  return [...phoneLikeCandidates, ...tokenRunCandidates, allDigitsCandidate].filter(Boolean);
}

function normalizeUsPhone(rawDigits) {
  const digits = String(rawDigits || "").replace(/\D/g, "");
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }
  if (digits.length > 11 && digits.startsWith("1")) {
    return `+${digits.slice(0, 11)}`;
  }
  return null;
}

function parsePreferredPhone(transcript) {
  const source = String(transcript || "").trim();
  if (!source) {
    return { phoneRaw: "", phoneNormalized: null, confidence: 0 };
  }
  if (/^\s*\+(?!1(?:\D|$))/.test(source)) {
    return {
      phoneRaw: source.replace(/[^\d]/g, "") || source,
      phoneNormalized: null,
      confidence: 0.25
    };
  }

  const candidates = buildPhoneCandidates(source);
  const candidate = candidates.find((value) => normalizeUsPhone(value)) || candidates[0] || toDigitsFromWords(source);
  const phoneNormalized = normalizeUsPhone(candidate);

  if (!phoneNormalized) {
    return {
      phoneRaw: candidate || source,
      phoneNormalized: null,
      confidence: 0.25
    };
  }

  return {
    phoneRaw: candidate,
    phoneNormalized,
    confidence: 0.88
  };
}

module.exports = {
  parsePreferredPhone
};
