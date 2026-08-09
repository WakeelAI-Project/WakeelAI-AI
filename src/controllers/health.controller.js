/**
 * Health check endpoint handler.
 * Does NOT execute any AI or DB logic.
 * 
 * @param {import("express").Request} req 
 * @param {import("express").Response} res 
 */
export const getHealth = (req, res) => {
  res.status(200).json({
    status: "ok",
    service: "wakeel-ai"
  });
};
