const bcrypt = require("bcrypt");
const baseRepo = requireUtil("baseRepo");
const verificationsRepo = requireRepo("verifications");
const tokensRepo = requireRepo("tokens");
const { resetPasswordVerificationEvent } = require("../events");
const table = "admins";
const isDateInPast = requireFunction("isDateInPast");

const findUserByValue = async (where = {}, whereNot = {}) => {
  return await baseRepo.countAll(table, where, whereNot);
};

const first = async (payload) => {
  return await baseRepo.first(table, payload);
};

const authenticateWithPassword = async (payload) => {
  let admin = await baseRepo.first(table, {
    email: payload.email?.toLowerCase(),
  });

  if (admin === undefined) {
    throw {
      statusCode: 422,
      message: "NotRegistered",
    };
  }

  let result = bcrypt.compareSync(payload.password, admin.password);

  if (result) {
    let token = await tokensRepo.createTokenForAdmin(admin);
    return token;
  } else {
    throw {
      statusCode: 422,
      message: "Invalid Username or Password",
    };
  }
};

const requestAttributeVerificationForResetPassword = async (payload) => {
  try {
    // Find if there is already an existing verification for this
    let verification = await verificationsRepo.findVerificationForResetPassword(
      {
        attribute_type: "email",
        attribute_value: payload.value,
      }
    );

    // If verification is present already, we can update it
    if (verification !== undefined) {
      let verificationObject = await verificationsRepo.updateVerification({
        uuid: verification.uuid,
      });

      await resetPasswordVerificationEvent({
        user_uuid: verificationObject.user_uuid,
        token: verificationObject.token,
        type: verificationObject.attribute_type,
        value: verificationObject.attribute_value,
        contact_infos: [
          {
            type: payload.type,
            value: verificationObject.attribute_value,
          },
        ],
      });
    } else {
      let admin = await baseRepo.first(table, {
        email: payload.value,
      });

      let verificationObject =
        await verificationsRepo.createVerificationForResetPassword({
          user_uuid: admin.uuid,
          attribute_type: "email",
          attribute_value: payload.value,
        });

      await resetPasswordVerificationEvent({
        user_uuid: verificationObject.user_uuid,
        token: verificationObject.token,
        type: verificationObject.attribute_type,
        value: verificationObject.attribute_value,
        contact_infos: [
          {
            type: "email",
            value: verificationObject.attribute_value,
          },
        ],
      });
    }
  } catch (error) {
    throw error;
  }
};

const verifyAttributeForResetPassword = async (payload) => {
  try {
    let verification = await verificationsRepo.findVerificationForResetPassword(
      {
        attribute_type: "email",
        attribute_value: payload.value?.toLowerCase(),
      }
    );

    if (verification !== undefined && !isDateInPast(verification.expires_at)) {
      if (payload.token === verification.token) {
        await updateAdminPassword(verification.user_uuid, payload.password);

        await verificationsRepo.removeVerification({
          uuid: verification.uuid,
        });

        return {
          message: "Verification Successful",
        };
      } else {
        throw "err";
      }
    } else {
      throw "err";
    }
  } catch (error) {
    throw {
      statusCode: 422,
      message: "Invalid Token",
    };
  }
};

const updateAdminPassword = async (uuid, password) => {
  return await baseRepo.update(
    table,
    { uuid: uuid },
    {
      password: bcrypt.hashSync(password, 5),
    }
  );
};

const isSuperUser = async (uuid) => {
  let admin = await baseRepo.first(table, {
    uuid: uuid,
  });

  if (admin && admin.permissions && "superuser" in admin.permissions) {
    return true;
  } else {
    return false;
  }
};

const createAdmin = async (payload) => {
  let admin = await baseRepo.first(table, {
    email: payload.email,
  });
  if (admin === undefined) {
    return await baseRepo.create(table, {
      email: payload.email,
      password: bcrypt.hashSync(payload.password, 5),
    });
  } else {
    throw {
      message: "Admin already exists",
    };
  }
};

const deleteAdmin = async (payload) => {
  try {
    let loggedInAdmin = payload.logedAdminUuid;
    let deletingAdmin = payload.deleteAdminUuid;

    if (loggedInAdmin === deletingAdmin) {
      throw {
        message: "This operation is not allowed",
      };
    } else {
      let superUser = await isSuperUser(deletingAdmin);
      if (superUser) {
        throw {
          message: "You are not allowed to delete this user",
        };
      } else {
        let admin = await baseRepo.first(table, {
          uuid: deletingAdmin,
        });
        if (admin !== undefined) {
          await tokensRepo.deleteTokenByConstraints({
            sub: deletingAdmin,
          });
          await baseRepo.remove(table, {
            uuid: deletingAdmin,
          });
          return {
            message: "Admin user deleted successfully",
          };
        } else {
          throw {
            message: "Admin user not found",
          };
        }
      }
    }
  } catch (err) {
    throw err;
  }
};

module.exports = {
  authenticateWithPassword,
  requestAttributeVerificationForResetPassword,
  verifyAttributeForResetPassword,
  findUserByValue,
  first,
  updateAdminPassword,
  isSuperUser,
  createAdmin,
  deleteAdmin,
};
