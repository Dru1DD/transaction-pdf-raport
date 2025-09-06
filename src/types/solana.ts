export interface UiTokenAmount {
    amount: string;
    decimals: number;
    uiAmount?: number | null;
    uiAmountString?: string;
}


export interface TokenBalance {
    accountIndex: number;
    mint: string;
    owner?: string;
    programId?: string;
    uiTokenAmount: UiTokenAmount;
}


export interface AccountMetaKey {
    pubkey: string;
    signer: boolean;
    writable: boolean;
}


export interface ParsedInstruction {
    program: string;
    programId: string;
    parsed?: any;
}


export interface TransactionMessage {
    accountKeys: AccountMetaKey[];
    instructions: ParsedInstruction[];
}


export interface TransactionInnerInstruction {
    index: number;
    instructions: ParsedInstruction[];
}


export interface GetTransactionMeta {
    fee: number;
    preBalances: number[];
    postBalances: number[];
    preTokenBalances?: TokenBalance[];
    postTokenBalances?: TokenBalance[];
    innerInstructions?: TransactionInnerInstruction[];
}


export interface GetTransactionResponse {
    slot: number;
    blockTime?: number;
    meta: GetTransactionMeta | null;
    transaction: {
        message: TransactionMessage;
        signatures: string[];
    };
    version?: string | number | null;
}
