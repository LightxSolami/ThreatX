import { isIP } from "node:net";
import type { DiscussionMessage } from "./orchestrator";
import type { NewsItem } from "./news-aggregator";
import { DEFAULT_SVM_RPC_URL, SVM_GENESIS_HASHES } from "@/lib/svm-network";

export type VerificationStatus =
  | "VERIFIED"
  | "PARTIALLY_VERIFIED"
  | "FALSE"
  | "UNVERIFIED"
  | "DISPUTED";

export type EvidenceType =
  | "OFFICIAL_PROTOCOL_DOCUMENTATION"
  | "ON_CHAIN_TRANSACTION"
  | "BLOCKCHAIN_EXPLORER"
  | "GOVERNMENT_OR_REGULATORY_FILING"
  | "COMPANY_DISCLOSURE"
  | "REPUTABLE_NEWS"
  | "ANALYTICS_PROVIDER"
  | "COMMUNITY_REPORT"
  | "AI_INFERENCE";

export interface DebateSource {
  id: string;
  url: string;
  title: string;
  publisher: string;
  publicationDate: string | null;
  eventDate: string | null;
  lastRetrievedAt: string | null;
  evidenceType: EvidenceType;
  classification: "primary" | "secondary" | "community";
  reliabilityAssessment: string;
}

export interface ClaimVerification {
  claimId: string;
  originalClaim: string;
  normalizedClaim: string;
  verificationStatus: VerificationStatus;
  confidenceScore: number;
  confidenceReason: string;
  explanation: string;
  evidenceExcerpt: string | null;
  evidenceType: EvidenceType | null;
  reportedSources: DebateSource[];
  supportingSources: DebateSource[];
  contradictingSources: DebateSource[];
  analystDisagreement: string;
  missingInformation: string[];
  analystNotes: string;
  lastVerifiedAt: string | null;
  treasuryMetrics: TreasuryMetrics | null;
  reviewRequired: boolean;
}

export interface TreasuryMetrics {
  totalHoldingsSol: number | null;
  periodPurchasesSol: number | null;
}

export interface VerifiedTransaction {
  signature: string;
  network: "mainnet-beta";
  slot: number;
  blockTime: string | null;
  status: "successful" | "failed";
  feeLamports: number;
  accountKeys: string[];
  instructionCount: number;
  explorerUrl: string;
}

export interface VerificationReport {
  claims: ClaimVerification[];
  counts: Record<VerificationStatus, number>;
  lastVerifiedAt: string | null;
  unknowns: string[];
  overallAssessment: string;
}

const SOLANA_FEES_SOURCE: DebateSource = {
  id: "solana-core-fees",
  url: "https://solana.com/docs/core/fees",
  title: "Solana Documentation: Fees",
  publisher: "Solana",
  publicationDate: null,
  eventDate: null,
  lastRetrievedAt: null,
  evidenceType: "OFFICIAL_PROTOCOL_DOCUMENTATION",
  classification: "primary",
  reliabilityAssessment: "Official protocol documentation; this curated rule has not live-fetched the page.",
};

const VERIFICATION_STATUSES: VerificationStatus[] = [
  "VERIFIED",
  "PARTIALLY_VERIFIED",
  "FALSE",
  "UNVERIFIED",
  "DISPUTED",
];

export function isSafeSourceUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return url.protocol === "https:"
      && !url.username
      && !url.password
      && !isIP(hostname)
      && hostname !== "localhost"
      && !hostname.endsWith(".localhost")
      && !hostname.endsWith(".local");
  } catch {
    return false;
  }
}

function sourceForNewsItem(item: NewsItem, retrievedAt: string): DebateSource[] {
  if (!isSafeSourceUrl(item.url)) return [];

  const hostname = new URL(item.url).hostname.toLowerCase();
  const isOfficial = item.source.startsWith("Solana Foundation")
    || hostname === "solana.com"
    || hostname.endsWith(".solana.com");
  const isCommunity = item.source === "GitHub Trending";
  return [{
    id: item.id,
    url: item.url,
    title: item.title,
    publisher: item.source,
    publicationDate: item.publishedAt || null,
    eventDate: null,
    lastRetrievedAt: item.retrievedAt ?? retrievedAt,
    evidenceType: isOfficial
      ? "OFFICIAL_PROTOCOL_DOCUMENTATION"
      : isCommunity
        ? "COMMUNITY_REPORT"
        : "REPUTABLE_NEWS",
    classification: isOfficial ? "primary" : isCommunity ? "community" : "secondary",
    reliabilityAssessment: isOfficial
      ? "Official source; this page is cited for what it reports, not as proof of every claim."
      : isCommunity
        ? "Community source; not independently corroborated."
        : "Publisher reputation is not independently assessed; reporting alone does not verify the claim.",
  }];
}

function makeBaseClaim(
  item: NewsItem,
  retrievedAt: string,
  messages: DiscussionMessage[]
): ClaimVerification {
  const sources = sourceForNewsItem(item, retrievedAt);
  const treasuryMetrics = extractTreasuryMetrics(`${item.title} ${item.summary}`);
  const containsWashTradingAllegation = /wash[\s-]?trading/i.test(`${item.title} ${item.summary}`);
  const containsSimdStatusClaim = /\bSIMD-\d+\b/i.test(`${item.title} ${item.summary}`)
    && /\b(implemented|live|shipped|deployed)\b/i.test(`${item.title} ${item.summary}`);
  const analystTexts = messages.map(message => message.content);

  return {
    claimId: item.id,
    originalClaim: item.title,
    normalizedClaim: item.title.trim().replace(/\s+/g, " "),
    verificationStatus: "UNVERIFIED",
    confidenceScore: 0,
    confidenceReason: "No independent primary evidence has been retrieved. This score reflects evidence coverage, not the probability that the claim is true.",
    explanation: containsWashTradingAllegation
      ? "A wash-trading allegation requires transaction-level evidence. The available article does not provide verified wallet relationships or transaction flows."
      : containsSimdStatusClaim
        ? "A proposal identifier alone does not establish implementation. The proposal status and deployed protocol version have not been independently checked."
        : "This headline is a report of a claim, not independent evidence that the claim is true. No corroborating source was retrieved.",
    evidenceExcerpt: sources.length ? `${item.title}${item.summary ? ` — ${item.summary.slice(0, 400)}` : ""}` : null,
    evidenceType: sources[0]?.evidenceType ?? null,
    reportedSources: sources,
    supportingSources: [],
    contradictingSources: [],
    analystDisagreement: analystTexts.length > 1
      ? "Analyst comments are shown separately below; automated claim-level disagreement detection is unavailable."
      : "No independent analyst comparison is available.",
    missingInformation: containsWashTradingAllegation
      ? ["Wallet-level evidence", "Transaction signatures", "A reproducible wallet-clustering method"]
      : containsSimdStatusClaim
        ? ["Current proposal status", "Implemented release or validator adoption evidence"]
        : ["Independent corroboration", "Primary evidence for the reported claim"],
    analystNotes: "AI analysis and source text are untrusted inputs; neither is accepted as verification evidence.",
    lastVerifiedAt: null,
    treasuryMetrics: treasuryMetrics.totalHoldingsSol === null && treasuryMetrics.periodPurchasesSol === null
      ? null
      : treasuryMetrics,
    reviewRequired: false,
  };
}

function matchesFeeBurnDenial(claim: string): boolean {
  return /\b(?:solana\s+)?(?:has\s+no|does\s+not\s+have|doesn't\s+have|lacks?)\s+(?:a\s+)?(?:transaction\s+)?fee[- ]burn(?:ing)?(?:\s+mechanism)?\b/i.test(claim)
    || /\bno\s+fee[- ]burn(?:ing)?\s+mechanism\b/i.test(claim);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function callMainnetRpc(method: string, params: unknown[]): Promise<unknown> {
  const response = await fetch(DEFAULT_SVM_RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Mainnet RPC returned HTTP ${response.status}`);
  const payload: unknown = await response.json();
  if (!isRecord(payload)) throw new Error("Mainnet RPC returned an invalid response");
  if (isRecord(payload.error)) {
    throw new Error(typeof payload.error.message === "string" ? payload.error.message : "Mainnet RPC request failed");
  }
  return payload.result;
}

export async function verifySolanaTransaction(signature: string): Promise<VerifiedTransaction | null> {
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature)) {
    throw new Error("Invalid Solana transaction signature");
  }

  const genesisHash = await callMainnetRpc("getGenesisHash", []);
  if (genesisHash !== SVM_GENESIS_HASHES.Mainnet) {
    throw new Error("Configured RPC endpoint is not Solana Mainnet");
  }

  const result = await callMainnetRpc("getTransaction", [
    signature,
    { commitment: "confirmed", encoding: "json", maxSupportedTransactionVersion: 0 },
  ]);
  if (result === null) return null;
  if (!isRecord(result) || !isRecord(result.transaction) || !isRecord(result.transaction.message)) {
    throw new Error("Mainnet RPC returned invalid transaction details");
  }

  const signatures = result.transaction.signatures;
  const slot = result.slot;
  const meta = result.meta;
  if (
    !Array.isArray(signatures)
    || !signatures.includes(signature)
    || typeof slot !== "number"
    || !isRecord(meta)
    || typeof meta.fee !== "number"
  ) {
    throw new Error("Mainnet RPC transaction details failed validation");
  }

  const keys = result.transaction.message.accountKeys;
  const accountKeys = Array.isArray(keys)
    ? keys.flatMap(key => typeof key === "string"
      ? [key]
      : isRecord(key) && typeof key.pubkey === "string"
        ? [key.pubkey]
        : [])
    : [];
  const blockTime = typeof result.blockTime === "number"
    ? new Date(result.blockTime * 1000).toISOString()
    : null;

  return {
    signature,
    network: "mainnet-beta",
    slot,
    blockTime,
    status: meta.err === null ? "successful" : "failed",
    feeLamports: meta.fee,
    accountKeys,
    instructionCount: Array.isArray(result.transaction.message.instructions)
      ? result.transaction.message.instructions.length
      : 0,
    explorerUrl: `https://explorer.solana.com/tx/${signature}?cluster=mainnet-beta`,
  };
}

async function verifyClaim(item: NewsItem, retrievedAt: string, messages: DiscussionMessage[]): Promise<ClaimVerification> {
  const base = makeBaseClaim(item, retrievedAt, messages);
  if (!matchesFeeBurnDenial(`${item.title} ${item.summary}`)) return base;

  const now = new Date(retrievedAt).toISOString();
  return {
    ...base,
    verificationStatus: "FALSE",
    confidenceScore: 95,
    confidenceReason: "The claim directly contradicts the curated protocol rule that half of base transaction fees are burned. Confidence represents evidence strength, not probability.",
    explanation: "Solana's base transaction fee mechanism burns 50% of the base fee; the remaining 50% is distributed to the validator. Priority fees are handled separately.",
    evidenceExcerpt: "50% of the base transaction fee is burned.",
    evidenceType: SOLANA_FEES_SOURCE.evidenceType,
    reportedSources: base.reportedSources,
    supportingSources: [],
    contradictingSources: [SOLANA_FEES_SOURCE],
    analystDisagreement: "The protocol fact-check takes priority over analyst consensus.",
    missingInformation: ["Live retrieval timestamp for the official documentation"],
    analystNotes: "This result uses a curated protocol fact. The linked documentation was not live-fetched during this verification run.",
    lastVerifiedAt: now,
    reviewRequired: true,
  };
}

async function verifyTransactionClaim(
  claim: ClaimVerification,
  signature: string,
  retrievedAt: string
): Promise<ClaimVerification> {
  try {
    const transaction = await verifySolanaTransaction(signature);
    if (!transaction) {
      return {
        ...claim,
        explanation: "The cited transaction signature was not found on verified Solana Mainnet.",
        missingInformation: ["A valid Mainnet transaction signature", "Transaction details from an independent source"],
      };
    }

    const source: DebateSource = {
      id: `tx-${transaction.signature}`,
      url: transaction.explorerUrl,
      title: `Solana Mainnet transaction ${transaction.signature.slice(0, 8)}…`,
      publisher: "Solana Mainnet RPC",
      publicationDate: transaction.blockTime,
      eventDate: transaction.blockTime,
      lastRetrievedAt: retrievedAt,
      evidenceType: "ON_CHAIN_TRANSACTION",
      classification: "primary",
      reliabilityAssessment: "Transaction signature, network genesis hash, slot, block time, fee and instruction count were checked against Mainnet RPC.",
    };

    return {
      ...claim,
      verificationStatus: "PARTIALLY_VERIFIED",
      confidenceScore: 80,
      confidenceReason: "The cited transaction and its Mainnet metadata were verified. This does not by itself establish the article's broader interpretation.",
      explanation: `The signature exists on ${transaction.network} at slot ${transaction.slot}; status: ${transaction.status}; fee: ${transaction.feeLamports} lamports; ${transaction.instructionCount} instruction(s).`,
      evidenceExcerpt: `Mainnet slot ${transaction.slot}; block time ${transaction.blockTime ?? "unavailable"}; ${transaction.accountKeys.length} account key(s).`,
      evidenceType: "ON_CHAIN_TRANSACTION",
      reportedSources: claim.reportedSources,
      supportingSources: [source],
      lastVerifiedAt: retrievedAt,
    };
  } catch (error) {
    console.error("Solana transaction verification failed:", error);
    return {
      ...claim,
      analystNotes: "Mainnet transaction verification could not be completed.",
      missingInformation: [...claim.missingInformation, "Successful Mainnet RPC verification"],
    };
  }
}

export function extractTreasuryMetrics(text: string): TreasuryMetrics {
  const numberWithUnit = "(\\d[\\d,.]*)\\s*(million|m|thousand|k)?\\s*SOL";
  const holdingsPattern = new RegExp(`\\b(?:holds?|holding|holdings|total holdings)\\b[^.\\n]{0,40}?${numberWithUnit}`, "i");
  const purchasesPattern = new RegExp(`\\b(?:purchased|bought|acquired)\\b[^.\\n]{0,30}?${numberWithUnit}`, "i");

  function parse(match: RegExpMatchArray | null): number | null {
    if (!match) return null;
    const amount = Number(match[1].replace(/,/g, ""));
    if (!Number.isFinite(amount)) return null;
    const unit = (match[2] || "").toLowerCase();
    return amount * (unit === "million" || unit === "m" ? 1_000_000 : unit === "thousand" || unit === "k" ? 1_000 : 1);
  }

  return {
    totalHoldingsSol: parse(text.match(holdingsPattern)),
    periodPurchasesSol: parse(text.match(purchasesPattern)),
  };
}

function getComparableSolMetric(text: string): { key: string; value: number } | null {
  const treasury = extractTreasuryMetrics(text);
  if (treasury.periodPurchasesSol !== null) {
    return { key: "period-purchases-sol", value: treasury.periodPurchasesSol };
  }
  if (treasury.totalHoldingsSol !== null) {
    return { key: "treasury-holdings-sol", value: treasury.totalHoldingsSol };
  }
  const supply = text.match(/\b(?:total\s+)?(?:SOL\s+)?supply\b[^.\n]{0,40}?([\d,.]+)\s*(million|m|thousand|k)?\s*SOL\b/i);
  if (!supply) return null;
  const amount = Number(supply[1].replace(/,/g, ""));
  if (!Number.isFinite(amount)) return null;
  const unit = (supply[2] || "").toLowerCase();
  return {
    key: "sol-supply",
    value: amount * (unit === "million" || unit === "m" ? 1_000_000 : unit === "thousand" || unit === "k" ? 1_000 : 1),
  };
}

function markConflictingReportsDisputed(
  items: NewsItem[],
  claims: ClaimVerification[]
): ClaimVerification[] {
  const groups = new Map<string, Array<{ claim: ClaimVerification; value: number }>>();
  for (const item of items) {
    const metric = getComparableSolMetric(`${item.title} ${item.summary}`);
    const claim = claims.find(candidate => candidate.claimId === item.id);
    if (!metric || !claim || claim.reportedSources[0]?.classification !== "secondary") continue;
    const group = groups.get(metric.key) || [];
    group.push({ claim, value: metric.value });
    groups.set(metric.key, group);
  }

  const disputedIds = new Set<string>();
  const updates = new Map<string, ClaimVerification>();
  for (const group of Array.from(groups.values())) {
    const values = new Set(group.map(entry => entry.value));
    if (group.length < 2 || values.size < 2) continue;
    const reports = group.flatMap(entry => entry.claim.reportedSources);
    for (const entry of group) {
      disputedIds.add(entry.claim.claimId);
      updates.set(entry.claim.claimId, {
        ...entry.claim,
        verificationStatus: "DISPUTED",
        confidenceScore: 45,
        confidenceReason: "Independent publishers report different values for a comparable metric; the reporting periods and calculation methods have not been reconciled.",
        explanation: "The available reports conflict on this metric. Neither value is treated as established without matching reporting periods and definitions.",
        reportedSources: reports,
        analystDisagreement: "Sources disagree on the reported figure; analyst consensus cannot resolve the conflict.",
        missingInformation: [...entry.claim.missingInformation, "Comparable reporting periods", "Source methodology and definitions"],
        analystNotes: "Conflict detection only compares headline-level SOL metric values from secondary reporting. It does not determine which figure is correct.",
        lastVerifiedAt: null,
        reviewRequired: true,
      });
    }
  }

  return claims.map(claim => updates.get(claim.claimId) ?? claim);
}

export async function createVerificationReport(
  newsItems: NewsItem[],
  messages: DiscussionMessage[],
  retrievedAt: string
): Promise<VerificationReport> {
  let transactionChecks = 0;
  const claims = await Promise.all(newsItems.map(async item => {
    const claim = await verifyClaim(item, retrievedAt, messages);
    const signature = `${item.title} ${item.summary}`.match(/\b[1-9A-HJ-NP-Za-km-z]{64,88}\b/)?.[0];
    if (!signature || claim.verificationStatus === "FALSE") return claim;
    if (transactionChecks >= 2) {
      return {
        ...claim,
        analystNotes: "Transaction verification is capped at two signatures per discussion to limit Mainnet RPC usage.",
        missingInformation: [...claim.missingInformation, "Transaction verification was deferred by the per-session limit"],
      };
    }
    transactionChecks += 1;
    return verifyTransactionClaim(claim, signature, retrievedAt);
  }));
  const reconciledClaims = markConflictingReportsDisputed(newsItems, claims);
  const counts = Object.fromEntries(VERIFICATION_STATUSES.map(status => [
    status,
    reconciledClaims.filter(claim => claim.verificationStatus === status).length,
  ])) as Record<VerificationStatus, number>;
  const verifiedAt = reconciledClaims
    .map(claim => claim.lastVerifiedAt)
    .filter((timestamp): timestamp is string => timestamp !== null)
    .sort()
    .slice(-1)[0] ?? null;
  const overallAssessment = claims.length === 0
    ? "No factual claims were available to assess."
    : counts.DISPUTED > 0
      ? "Sources conflict on one or more reported metrics; no disputed value is treated as established."
      : counts.FALSE > 0
        ? "At least one claim conflicts with a curated protocol fact. Review the cited evidence and limitations."
        : counts.VERIFIED + counts.PARTIALLY_VERIFIED > 0
          ? "Some evidence was checked, but partial verification does not establish the broader claim."
          : "Available reporting has not been independently corroborated; no general truth verdict is made.";

  return {
    claims: reconciledClaims,
    counts,
    lastVerifiedAt: verifiedAt,
    overallAssessment,
    unknowns: reconciledClaims
      .filter(claim => claim.verificationStatus === "UNVERIFIED" || claim.verificationStatus === "DISPUTED")
      .map(claim => `${claim.originalClaim}: ${claim.explanation}`),
  };
}

export function createUntrustedNewsContext(newsItems: NewsItem[]): string {
  return JSON.stringify(newsItems.map(item => ({
    source: item.source.slice(0, 80),
    title: item.title.slice(0, 300),
    summary: item.summary.slice(0, 500),
    url: isSafeSourceUrl(item.url) ? item.url : null,
    publishedAt: item.publishedAt,
    tags: item.tags.slice(0, 5),
  })));
}
