const YES_PATTERNS = [
  /\byes\b/i,
  /\byeah\b/i,
  /\bye\b/i,
  /\byep\b/i,
  /\byup\b/i,
  /\bsure\b/i,
  /\babsolutely\b/i,
  /\bdefinitely\b/i,
  /\bok(?:ay)?\b/i,
  /\b(?:i am|i'?m|we are|we'?re)(?!\s+not)\b/i,
  /\b(?:i am|i'?m|we are|we'?re)\s+interested\b/i,
  /\binterested in selling\b/i,
  /\bthat works\b/i
];

const NO_PATTERNS = [
  /\bno\b/i,
  /\bnope\b/i,
  /\bnah\b/i,
  /\bno thanks\b/i,
  /\bnot now\b/i,
  /\bnot right now\b/i,
  /\bnot at this time\b/i,
  /\bnot interested\b/i,
  /\bnot selling\b/i,
  /\b(?:i am|i'?m|we are|we'?re)\s+not\b/i,
  /\bdo not want\b/i,
  /\bdon'?t want\b/i,
  /\bdo not call\b/i,
  /\bdon'?t call\b/i,
  /\bstop calling\b/i,
  /\bwrong number\b/i
];

function parseInterestIntent(transcript) {
  const text = String(transcript || "").trim();
  if (!text) {
    return { intent: "unknown", confidence: 0 };
  }

  const yesHit = YES_PATTERNS.some((pattern) => pattern.test(text));
  const noHit = NO_PATTERNS.some((pattern) => pattern.test(text));

  if (yesHit && !noHit) {
    return { intent: "yes", confidence: 0.9 };
  }

  if (noHit && !yesHit) {
    return { intent: "no", confidence: 0.92 };
  }

  return { intent: "unknown", confidence: yesHit || noHit ? 0.4 : 0.2 };
}

module.exports = {
  parseInterestIntent
};
