import { Router } from "express";
import { authenticate } from "../../middleware/auth";
import { validateRequest } from "../../middleware/validateRequest";
import {
  createEmployeeGroupSchema,
  updateEmployeeGroupSchema,
  listEmployeeGroupsQuerySchema,
  employeeGroupIdParamSchema,
} from "./employeeGroup.validators";
import {
  listEmployeeGroupsHandler,
  getEmployeeGroupHandler,
  createEmployeeGroupHandler,
  updateEmployeeGroupHandler,
} from "./employeeGroup.controller";

export const employeeGroupRouter = Router();
employeeGroupRouter.use(authenticate);

employeeGroupRouter.get("/employee-groups", validateRequest({ query: listEmployeeGroupsQuerySchema }), listEmployeeGroupsHandler);
employeeGroupRouter.get(
  "/employee-groups/:id",
  validateRequest({ params: employeeGroupIdParamSchema }),
  getEmployeeGroupHandler
);
employeeGroupRouter.post(
  "/employee-groups",
  validateRequest({ body: createEmployeeGroupSchema }),
  createEmployeeGroupHandler
);
employeeGroupRouter.patch(
  "/employee-groups/:id",
  validateRequest({ params: employeeGroupIdParamSchema, body: updateEmployeeGroupSchema }),
  updateEmployeeGroupHandler
);
