import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/shared/api";
import { getPortfolio } from "@/lib/portfolio/positions";

/**
 * The portfolio summary the dashboard renders, as JSON.
 *
 * The web dashboard is a server component that calls getPortfolio() directly,
 * so until now there was no way to read this over HTTP. The mobile app needs
 * exactly the same numbers, and the one thing worth avoiding is a second
 * implementation of the portfolio maths, so this is a thin wrapper over the
 * same function rather than a new query.
 */
export async function GET() {
  const { supabase, user, error } = await requireUser();
  if (error) return error;

  try {
    const portfolio = await getPortfolio(supabase, user.id);
    return NextResponse.json(portfolio);
  } catch (err) {
    return errorResponse(err);
  }
}
