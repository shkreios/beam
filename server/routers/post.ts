import { markdownToHtml } from '@/lib/editor'
import { postToSlackIfEnabled } from '@/lib/slack'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '@/server/api/trpc'

export const postRouter = createTRPCRouter({
  feed: protectedProcedure
    .input(
      z
        .object({
          take: z.number().min(1).max(50).optional(),
          skip: z.number().min(1).optional(),
          authorId: z.string().optional(),
        })
        .optional()
    )
    .query(async ({ input, ctx }) => {
      const take = input?.take ?? 50
      const skip = input?.skip
      const where = {
        hidden: ctx.isUserAdmin ? undefined : false,
        authorId: input?.authorId,
      }

      const posts = await ctx.prisma.post.findMany({
        take,
        skip,
        orderBy: {
          createdAt: 'desc',
        },
        where,
        select: {
          id: true,
          title: true,
          contentHtml: true,
          createdAt: true,
          hidden: true,
          author: {
            select: {
              id: true,
              name: true,
              image: true,
            },
          },
          likedBy: {
            orderBy: {
              createdAt: 'asc',
            },
            select: {
              user: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
          _count: {
            select: {
              comments: true,
            },
          },
        },
      })

      const postCount = await ctx.prisma.post.count({
        where,
      })

      return {
        posts,
        postCount,
      }
    }),

  detail: protectedProcedure
    .input(
      z.object({
        id: z.number(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { id } = input
      const post = await ctx.prisma.post.findUnique({
        where: { id },
        select: {
          id: true,
          title: true,
          content: true,
          contentHtml: true,
          createdAt: true,
          hidden: true,
          author: {
            select: {
              id: true,
              name: true,
              image: true,
            },
          },
          likedBy: {
            orderBy: {
              createdAt: 'asc',
            },
            select: {
              user: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
          comments: {
            orderBy: {
              createdAt: 'asc',
            },
            select: {
              id: true,
              content: true,
              contentHtml: true,
              createdAt: true,
              author: {
                select: {
                  id: true,
                  name: true,
                  image: true,
                },
              },
            },
          },
        },
      })

      const postBelongsToUser = post?.author.id === ctx.session.user.id

      if (!post || (post.hidden && !postBelongsToUser && !ctx.isUserAdmin)) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `No post with id '${id}'`,
        })
      }

      return post
    }),

  search: protectedProcedure
    .input(
      z.object({
        query: z.string().min(1),
      })
    )
    .query(async ({ input, ctx }) => {
      const posts = await ctx.prisma.post.findMany({
        take: 10,
        where: {
          hidden: false,
          title: { search: input.query },
          content: { search: input.query },
        },
        select: {
          id: true,
          title: true,
        },
      })

      return posts
    }),

  add: protectedProcedure
    .input(
      z.object({
        title: z.string().min(1),
        content: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const post = await ctx.prisma.post.create({
        data: {
          title: input.title,
          content: input.content,
          contentHtml: markdownToHtml(input.content),
          author: {
            connect: {
              id: ctx.session.user.id,
            },
          },
        },
      })

      await postToSlackIfEnabled({ post, authorName: ctx.session.user.name })

      return post
    }),

  edit: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        data: z.object({
          title: z.string().min(1),
          content: z.string().min(1),
        }),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, data } = input

      const post = await ctx.prisma.post.findUnique({
        where: { id },
        select: {
          author: {
            select: {
              id: true,
            },
          },
        },
      })

      const postBelongsToUser = post?.author.id === ctx.session.user.id

      if (!postBelongsToUser) {
        throw new TRPCError({ code: 'FORBIDDEN' })
      }

      const updatedPost = await ctx.prisma.post.update({
        where: { id },
        data: {
          title: data.title,
          content: data.content,
          contentHtml: markdownToHtml(data.content),
        },
      })

      return updatedPost
    }),

  delete: protectedProcedure
    .input(z.number())
    .mutation(async ({ input: id, ctx }) => {
      const post = await ctx.prisma.post.findUnique({
        where: { id },
        select: {
          author: {
            select: {
              id: true,
            },
          },
        },
      })

      const postBelongsToUser = post?.author.id === ctx.session.user.id

      if (!postBelongsToUser) {
        throw new TRPCError({ code: 'FORBIDDEN' })
      }

      await ctx.prisma.post.delete({ where: { id } })
      return id
    }),

  like: protectedProcedure
    .input(z.number())
    .mutation(async ({ input: id, ctx }) => {
      await ctx.prisma.likedPosts.create({
        data: {
          post: {
            connect: {
              id,
            },
          },
          user: {
            connect: {
              id: ctx.session.user.id,
            },
          },
        },
      })

      return id
    }),

  unlike: protectedProcedure
    .input(z.number())
    .mutation(async ({ input: id, ctx }) => {
      await ctx.prisma.likedPosts.delete({
        where: {
          postId_userId: {
            postId: id,
            userId: ctx.session.user.id,
          },
        },
      })

      return id
    }),

  hide: protectedProcedure
    .input(z.number())
    .mutation(async ({ input: id, ctx }) => {
      if (!ctx.isUserAdmin) {
        throw new TRPCError({ code: 'FORBIDDEN' })
      }

      const post = await ctx.prisma.post.update({
        where: { id },
        data: {
          hidden: true,
        },
        select: {
          id: true,
        },
      })
      return post
    }),

  unhide: protectedProcedure
    .input(z.number())
    .mutation(async ({ input: id, ctx }) => {
      if (!ctx.isUserAdmin) {
        throw new TRPCError({ code: 'FORBIDDEN' })
      }

      const post = await ctx.prisma.post.update({
        where: { id },
        data: {
          hidden: false,
        },
        select: {
          id: true,
        },
      })
      return post
    }),
})
