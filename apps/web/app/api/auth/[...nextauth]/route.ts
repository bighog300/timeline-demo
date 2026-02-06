import NextAuth from 'next-auth';
import { NextResponse } from 'next/server';

import { authOptions, isAuthConfigured } from '../../../lib/googleAuth';

const handler = NextAuth(authOptions);

export const GET = async (request: Request) => {
  if (!isAuthConfigured()) {
    return NextResponse.json({ error: 'not_configured' }, { status: 503 });
  }

  return handler(request);
};

export const POST = async (request: Request) => {
  if (!isAuthConfigured()) {
    return NextResponse.json({ error: 'not_configured' }, { status: 503 });
  }

  return handler(request);
};
