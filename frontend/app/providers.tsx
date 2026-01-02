'use client';

import * as React from 'react';
import { RainbowKitProvider, getDefaultWallets, getDefaultConfig } from '@rainbow-me/rainbowkit';
import { sepolia } from 'wagmi/chains';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider, http, fallback } from 'wagmi';
import '@rainbow-me/rainbowkit/styles.css';

const { wallets } = getDefaultWallets();

const config = getDefaultConfig({
  appName: 'ZkBoard',
  projectId: '3a8170812b534d0ff9d794f19a901d64', 
  wallets: wallets,
  chains: [sepolia],
  ssr: true,
  transports: {
    // ABBIAMO RIMOSSO BLASTAPI E MESSO PUBLICNODE + ANKR
    [sepolia.id]: fallback([
      http('https://ethereum-sepolia.publicnode.com'),
      http('https://rpc.ankr.com/eth_sepolia'),
      http('https://sepolia.drpc.org'),
    ]), 
  },
});

const queryClient = new QueryClient();

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider>
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
