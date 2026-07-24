import { NextFunction, Request, Response } from "express";
import { ZodType } from "zod";

interface Schemas {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

export function validateRequest(schemas: Schemas) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (schemas.body) req.body = schemas.body.parse(req.body);
    if (schemas.query) req.query = schemas.query.parse(req.query) as typeof req.query;
    if (schemas.params) req.params = schemas.params.parse(req.params) as typeof req.params;
    next();
  };
}
