import { createHash, timingSafeEqual } from "node:crypto";
import { errors as joseErrors, jwtVerify, SignJWT } from "jose";
import { env } from "../../config/env.js";
import { ErrorCodes } from "../../shared/constants/error-codes.js";
import { AppError } from "../../shared/errors/app-error.js";
import type { AuthContext } from "../../shared/types/api.js";
import type { LoginInput } from "./auth.validation.js";

/**
 * Authentication for the single predefined business-owner account.
 * Credentials come from the environment; there is no registration and no users file.
 */

const JWT_ALGORITHM = "HS256";
const JWT_ISSUER = "confirmely-backend";
const JWT_AUDIENCE = "confirmely-dashboard";
const secretKey = new TextEncoder().encode(env.JWT_ACCESS_SECRET);

export interface OwnerProfile {
  id: string;
  email: string;
  name: string;
  role: "owner";
}

export interface LoginResult {
  accessToken: string;
  tokenType: "Bearer";
  expiresAt: string;
  user: OwnerProfile;
}

export function getOwnerProfile(): OwnerProfile {
  return { id: env.ADMIN_ID, email: env.ADMIN_EMAIL, name: env.ADMIN_NAME, role: "owner" };
}

/** Constant-time string comparison (hashing first makes the lengths equal). */
function safeEqual(a: string, b: string): boolean {
  const digestA = createHash("sha256").update(a, "utf8").digest();
  const digestB = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(digestA, digestB);
}

export async function login(input: LoginInput): Promise<LoginResult> {
  // Evaluate both checks every time and return one generic error, so responses do not reveal
  // whether the email or the password was wrong.
  const emailMatches = safeEqual(input.email, env.ADMIN_EMAIL);
  const passwordMatches = safeEqual(input.password, env.ADMIN_PASSWORD);
  if (!emailMatches || !passwordMatches) {
    throw new AppError(401, ErrorCodes.INVALID_CREDENTIALS, "Invalid email or password");
  }

  const owner = getOwnerProfile();
  const accessToken = await new SignJWT({ email: owner.email })
    .setProtectedHeader({ alg: JWT_ALGORITHM, typ: "JWT" })
    .setSubject(owner.id)
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(env.JWT_ACCESS_EXPIRES_IN)
    .sign(secretKey);

  const { payload } = await jwtVerify(accessToken, secretKey, { algorithms: [JWT_ALGORITHM] });
  const expiresAt = new Date((payload.exp ?? 0) * 1000).toISOString();

  return { accessToken, tokenType: "Bearer", expiresAt, user: owner };
}

/** Verify an access token and return the owner it belongs to. Throws 401 on any problem. */
export async function verifyAccessToken(token: string): Promise<AuthContext> {
  try {
    const { payload } = await jwtVerify(token, secretKey, {
      algorithms: [JWT_ALGORITHM],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      requiredClaims: ["sub", "exp"],
    });
    // Tokens issued for a previously configured owner are no longer valid.
    if (payload.sub !== env.ADMIN_ID || typeof payload.email !== "string") {
      throw AppError.unauthorized("Invalid access token");
    }
    return { ownerId: payload.sub, email: payload.email };
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error instanceof joseErrors.JWTExpired) throw AppError.unauthorized("Access token expired");
    throw AppError.unauthorized("Invalid access token");
  }
}
