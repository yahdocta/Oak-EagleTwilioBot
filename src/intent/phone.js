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

  const directDigits = source.replace(/[^\d]/g, "");
  const digitsFromWords = toDigitsFromWords(source);

  const candidate = directDigits.length >= digitsFromWords.length ? directDigits : digitsFromWords;
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
