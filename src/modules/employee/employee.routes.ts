import { Router } from "express";
import { authenticate } from "../../middleware/auth";
import { validateRequest } from "../../middleware/validateRequest";
import { createEmployeeSchema, updateEmployeeSchema, listEmployeesQuerySchema, employeeIdParamSchema } from "./employee.validators";
import { listEmployeesHandler, getEmployeeHandler, createEmployeeHandler, updateEmployeeHandler } from "./employee.controller";

export const employeeRouter = Router();
employeeRouter.use(authenticate);

employeeRouter.get("/employees", validateRequest({ query: listEmployeesQuerySchema }), listEmployeesHandler);
employeeRouter.get("/employees/:id", validateRequest({ params: employeeIdParamSchema }), getEmployeeHandler);
employeeRouter.post("/employees", validateRequest({ body: createEmployeeSchema }), createEmployeeHandler);
employeeRouter.patch(
  "/employees/:id",
  validateRequest({ params: employeeIdParamSchema, body: updateEmployeeSchema }),
  updateEmployeeHandler
);
