import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, http } from 'viem';
import { sepolia } from 'viem/chains';
import { ZKBOARD_ADDRESS, ZKBOARD_ABI } from '@/app/utils/constants';

const client = createPublicClient({
  chain: sepolia,
  transport: http(),
});

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json({ error: 'Missing id parameter' }, { status: 400 });
  }

  try {
    const data = await client.readContract({
      address: ZKBOARD_ADDRESS,
      abi: ZKBOARD_ABI,
      functionName: 'relayRequests',
      args: [BigInt(id)],
    });

    // Viem returns struct as object with named keys
    const requestData = data as any;

    return NextResponse.json({
      id,
      message: requestData.message || requestData[2],  // Index 2 (was 3 with proof)
      relayFee: (requestData.relayFee || requestData[3]).toString(),  // Index 3 (was 4)
      requester: requestData.requester || requestData[4],  // Index 4 (was 5)
      executed: requestData.executed !== undefined ? requestData.executed : requestData[5],  // Index 5 (was 6)
    });
  } catch (error) {
    console.error(`Error fetching relay request ${id}:`, error);
    return NextResponse.json({ error: 'Failed to fetch request' }, { status: 500 });
  }
}
