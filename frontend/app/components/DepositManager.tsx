'use client';

import { useState } from 'react';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { formatEther, parseEther } from 'viem';
import { ZKBOARD_ABI, ZKBOARD_ADDRESS, COST_PER_MESSAGE } from '../utils/constants';

export default function DepositManager() {
  const { address } = useAccount();
  const [rechargeAmount, setRechargeAmount] = useState('0.05');
  const [showRecharge, setShowRecharge] = useState(false);

  const { data: depositData, refetch: refetchDeposit } = useReadContract({
    address: ZKBOARD_ADDRESS,
    abi: ZKBOARD_ABI,
    functionName: 'deposits',
    args: address ? [address] : undefined,
    query: {
      enabled: !!address,
      refetchInterval: 10000,
    },
  });

  const { data: topUpHash, writeContract: topUp, isPending: isTopUpPending } = useWriteContract();
  const { data: withdrawHash, writeContract: withdraw, isPending: isWithdrawPending } = useWriteContract();

  useWaitForTransactionReceipt({
    hash: topUpHash,
    onSuccess() {
      refetchDeposit();
      setShowRecharge(false);
    },
  });

  useWaitForTransactionReceipt({
    hash: withdrawHash,
    onSuccess() {
      refetchDeposit();
    },
  });

  const deposit = depositData ? formatEther(depositData as bigint) : '0';
  // Calcola messaggi disponibili: deposits / COST_PER_MESSAGE
  const availableMessages = depositData
    ? Math.floor(Number(formatEther(depositData as bigint)) / Number(COST_PER_MESSAGE))
    : 0;
  const depositNum = parseFloat(deposit);
  const isLowBalance = depositNum < 0.01;

  const handleTopUp = () => {
    topUp({
      address: ZKBOARD_ADDRESS,
      abi: ZKBOARD_ABI,
      functionName: 'topUpDeposit',
      value: parseEther(rechargeAmount),
    });
  };

  const handleWithdraw = () => {
    if (confirm(`Withdraw ${deposit} ETH? This will reset your balance.`)) {
      withdraw({
        address: ZKBOARD_ADDRESS,
        abi: ZKBOARD_ABI,
        functionName: 'withdrawDeposit',
      });
    }
  };

  return (
    <div className="bg-gradient-to-br from-slate-800/50 to-slate-900/50 backdrop-blur-xl border border-slate-700/50 rounded-2xl p-6 shadow-xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-bold text-white">Account Balance</h3>
        {isLowBalance && (
          <span className="text-xs font-semibold text-amber-400 bg-amber-500/10 px-3 py-1 rounded-full animate-pulse">
            Low
          </span>
        )}
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-700/30">
          <div className="text-xs text-slate-400 mb-2">Deposit</div>
          <div className="text-2xl font-black text-white truncate">{parseFloat(deposit).toFixed(4)}</div>
          <div className="text-xs text-slate-500 mt-1">ETH</div>
        </div>

        <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-700/30">
          <div className="text-xs text-slate-400 mb-2">Available</div>
          <div className="text-2xl font-black text-indigo-400">{availableMessages}</div>
          <div className="text-xs text-slate-500 mt-1">messages</div>
        </div>
      </div>

      {/* Recharge Section */}
      {!showRecharge ? (
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => setShowRecharge(true)}
            className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-3 px-4 rounded-xl transition-all duration-200 hover:scale-105"
          >
            Top Up
          </button>
          {depositNum > 0 && (
            <button
              onClick={handleWithdraw}
              disabled={isWithdrawPending}
              className="bg-slate-700/50 hover:bg-slate-700 text-slate-300 font-semibold py-3 px-4 rounded-xl transition-all duration-200 hover:scale-105 disabled:opacity-50"
            >
              {isWithdrawPending ? 'Withdrawing...' : 'Withdraw'}
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <label className="text-xs text-slate-400 mb-2 block">Amount (ETH)</label>
            <input
              type="number"
              step="0.01"
              value={rechargeAmount}
              onChange={(e) => setRechargeAmount(e.target.value)}
              className="w-full bg-slate-900/50 border border-slate-700/50 rounded-xl px-4 py-3 text-white focus:border-indigo-500 focus:outline-none transition-colors"
              placeholder="0.05"
            />
            <div className="text-xs text-slate-500 mt-2">
              ≈ {Math.floor(parseFloat(rechargeAmount || '0') / Number(COST_PER_MESSAGE))} messages
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={handleTopUp}
              disabled={isTopUpPending}
              className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-3 px-4 rounded-xl transition-all duration-200 hover:scale-105 disabled:opacity-50"
            >
              {isTopUpPending ? 'Processing...' : 'Confirm'}
            </button>
            <button
              onClick={() => setShowRecharge(false)}
              className="bg-slate-700/50 hover:bg-slate-700 text-slate-300 font-semibold py-3 px-4 rounded-xl transition-all duration-200"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Transaction Links */}
      {(topUpHash || withdrawHash) && (
        <div className="mt-4 pt-4 border-t border-slate-700/30">
          {topUpHash && (
            <a
              href={`https://sepolia.etherscan.io/tx/${topUpHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-xs text-indigo-400 hover:text-indigo-300 text-center mb-2 transition-colors"
            >
              View top-up transaction →
            </a>
          )}
          {withdrawHash && (
            <a
              href={`https://sepolia.etherscan.io/tx/${withdrawHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-xs text-red-400 hover:text-red-300 text-center transition-colors"
            >
              View withdrawal transaction →
            </a>
          )}
        </div>
      )}
    </div>
  );
}
