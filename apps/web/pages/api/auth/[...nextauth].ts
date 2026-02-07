import type { NextApiRequest, NextApiResponse } from 'next';
import NextAuth, { type NextAuthOptions } from 'next-auth';

import { authOptions, isAuthConfigured } from '../../../app/lib/googleAuth';

const options = { ...authOptions, trustHost: true } as NextAuthOptions;

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (!isAuthConfigured()) {
    return res.status(503).json({ error: 'not_configured' });
  }

  return NextAuth(req, res, options);
};

export default handler;
