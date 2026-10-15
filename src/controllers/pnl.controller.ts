import { Request, Response } from 'express';
import { pnlService } from '../services/pnl.service';

export class PnLController {
  async getStatement(req: Request, res: Response) {
    try {
      const { branchId, startDate, endDate } = req.query;

      const statement = await pnlService.getProfitAndLossStatement({
        branchId: branchId as string | undefined,
        startDate: startDate as string | undefined,
        endDate: endDate as string | undefined,
      });

      res.status(200).json(statement);
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Failed to generate P&L statement' });
    }
  }
}
