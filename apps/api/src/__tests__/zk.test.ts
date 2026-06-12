import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import { zkRoutes } from "../routes/zk.js";

// Stub all Soroban/network calls so tests run offline
vi.mock("@stellar/stellar-sdk", async (importOriginal: () => Promise<typeof import("@stellar/stellar-sdk")>) => {
  const actual = await importOriginal();

  const fakeTx = { sign: vi.fn() };
  const fakeBuilder = {
    build: vi.fn().mockReturnValue(fakeTx),
  };

  return {
    ...actual,
    Networks: actual.Networks,
    nativeToScVal: actual.nativeToScVal,
    xdr: actual.xdr,
    Address: actual.Address,
    Keypair: {
      fromSecret: vi.fn().mockReturnValue({
        publicKey: () => "GBTESTAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      }),
    },
    Contract: class {
      call = vi.fn().mockReturnValue({});
    },
    TransactionBuilder: class {
      addOperation = vi.fn().mockReturnThis();
      setTimeout = vi.fn().mockReturnThis();
      build = vi.fn().mockReturnValue(fakeTx);
    },
    rpc: {
      ...actual.rpc,
      assembleTransaction: vi.fn().mockReturnValue(fakeBuilder),
      Server: class {
        getAccount = vi.fn().mockResolvedValue({ accountId: () => "GTEST", incrementSequenceNumber: vi.fn() });
        simulateTransaction = vi.fn().mockResolvedValue({ result: null });
        sendTransaction = vi.fn().mockResolvedValue({ status: "PENDING", hash: "aabbcc" });
        getTransaction = vi.fn().mockResolvedValue({
          status: "SUCCESS",
          returnValue: actual.xdr.ScVal.scvBool(true),
        });
      },
      Api: {
        ...actual.rpc?.Api,
        isSimulationError: () => false,
      },
    },
  };
});

const MOCK_PAYMENT_HEADER = "mock:GPAYER000000000000000000000000000000000000000000000000000:0.001";
const VALID_PROOF_B64 = Buffer.alloc(64).toString("base64");

describe("ZK Routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.ZK_VERIFIER_CONTRACT_ID = "CA000000000000000000000000000000000000000000000000000000";
    process.env.ADMIN_SECRET_KEY = "SCZANGBA5AKIA4HF6DVRZ53VBZ7GVMQXMKKFZWQ5MEBOU2CTKXEJC4";
    app = Fastify({ logger: false });
    await app.register(zkRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe("GET /api/v1/zk/circuits", () => {
    it("returns circuit list without payment", async () => {
      const res = await app.inject({ method: "GET", url: "/api/v1/zk/circuits" });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.circuits).toHaveLength(2);
      const ids = body.circuits.map((c: { circuit_id: string }) => c.circuit_id);
      expect(ids).toContain("poseidon_preimage");
      expect(ids).toContain("reputation_v1");
    });

    it("includes payment info", async () => {
      const res = await app.inject({ method: "GET", url: "/api/v1/zk/circuits" });
      const body = JSON.parse(res.body);
      expect(body.payment.amount_usdc).toBe("0.001");
    });
  });

  describe("POST /api/v1/zk/verify", () => {
    it("returns 402 without payment header", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/zk/verify",
        payload: { circuit_id: "poseidon_preimage", proof: VALID_PROOF_B64, public_inputs: ["1234"] },
      });
      expect(res.statusCode).toBe(402);
    });

    it("returns 400 for unknown circuit_id", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/zk/verify",
        headers: { "x-payment": MOCK_PAYMENT_HEADER },
        payload: { circuit_id: "unknown_circuit", proof: VALID_PROOF_B64, public_inputs: ["1"] },
      });
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error).toMatch(/Unknown circuit_id/);
    });

    it("returns 400 for wrong number of public_inputs (poseidon_preimage needs 1)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/zk/verify",
        headers: { "x-payment": MOCK_PAYMENT_HEADER },
        payload: {
          circuit_id: "poseidon_preimage",
          proof: VALID_PROOF_B64,
          public_inputs: ["1", "2"], // too many
        },
      });
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error).toMatch(/exactly 1/);
    });

    it("returns 400 for wrong number of public_inputs (reputation_v1 needs 4)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/zk/verify",
        headers: { "x-payment": MOCK_PAYMENT_HEADER },
        payload: {
          circuit_id: "reputation_v1",
          proof: VALID_PROOF_B64,
          public_inputs: ["1", "2"], // too few
        },
      });
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error).toMatch(/exactly 4/);
    });

    it("returns 400 for non-decimal public_input", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/zk/verify",
        headers: { "x-payment": MOCK_PAYMENT_HEADER },
        payload: {
          circuit_id: "poseidon_preimage",
          proof: VALID_PROOF_B64,
          public_inputs: ["0xdeadbeef"], // hex not allowed
        },
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toMatch(/decimal/);
    });

    it("returns 400 for empty proof", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/zk/verify",
        headers: { "x-payment": MOCK_PAYMENT_HEADER },
        payload: {
          circuit_id: "poseidon_preimage",
          proof: "", // empty string → zero-length buffer → rejected
          public_inputs: ["1234"],
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns verified result for poseidon_preimage with mock payment", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/zk/verify",
        headers: { "x-payment": MOCK_PAYMENT_HEADER },
        payload: {
          circuit_id: "poseidon_preimage",
          proof: VALID_PROOF_B64,
          public_inputs: ["9876543210123456789"],
        },
      });
      if (res.statusCode !== 200) console.error("ZK 502 detail:", res.body);
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(typeof body.verified).toBe("boolean");
      expect(body.circuit_id).toBe("poseidon_preimage");
    });

    it("returns verified result for reputation_v1 with 4 inputs and mock payment", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/zk/verify",
        headers: { "x-payment": MOCK_PAYMENT_HEADER },
        payload: {
          circuit_id: "reputation_v1",
          proof: VALID_PROOF_B64,
          public_inputs: [
            "111111111111111111111111",
            "2",
            "333333333333333333333333",
            "444444444444444444444444",
          ],
        },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(typeof body.verified).toBe("boolean");
      expect(body.circuit_id).toBe("reputation_v1");
    });
  });
});
